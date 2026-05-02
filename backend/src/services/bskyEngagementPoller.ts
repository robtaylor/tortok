// Phase 3 Unit 2.5 — engagement poller (ADR-010 + ADR-010-A).
//
// Periodically scans `bridged_posts (mirror_state = 'pending')`,
// resolves engagement (`likeCount`, `repostCount`, `replyCount`)
// + author profile (`handle`, `displayName`, `avatar`,
// `followersCount`) via the public AppView, and either promotes
// the row to `mirrored` (when an engagement signal crosses a
// tunable threshold) or declines it (when it's older than
// `BSKY_DECLINE_AFTER_DAYS` and never qualified). Rows that are
// neither promoted nor declined stay `pending` and get re-polled
// on a future tick.
//
// Pipeline (per ADR-010-A Decision 4'):
//   firehose → pending → [poller: this file] → mirrored | declined
//                                                   ↓
//                                              [mirror pipeline (slice 3)]
//
// Mirror columns (`r2_path`, `magnet_link`, `torrent_file_url`)
// are slice 3's responsibility — this service only flips
// `mirror_state`. Bytes flow later.
//
// The public AppView is `https://public.api.bsky.app` — read-only,
// no auth, rate-limited (~3000 req/5min for unauthenticated). At
// 25 at-uris per call × ~30 min cadence we sit comfortably under.
// 429s are not fatal: tick logs and exits, increments a back-off
// counter, doubles the next tick delay if we hit 3 in a row.
//
// Singleton + hot-reload guard mirrors `bskyFirehose.ts`.
import { query } from '../db';

// ─── Constants ───────────────────────────────────────────────────

const PUBLIC_APPVIEW_BASE = 'https://public.api.bsky.app';
const GET_POSTS_PATH = '/xrpc/app.bsky.feed.getPosts';
const GET_PROFILES_PATH = '/xrpc/app.bsky.actor.getProfiles';

const BATCH_SIZE = 25;
const DEFAULT_POLL_INTERVAL_SEC = 1800; // 30 min
const DEFAULT_MIN_LIKES = 50;
const DEFAULT_MIN_REPOSTS = 10;
const DEFAULT_MIN_FOLLOWERS = 5000;
const DEFAULT_DECLINE_AFTER_DAYS = 7;

// Back-pressure tuning (per spec): 3 consecutive rate-limit ticks
// → double the next delay.
const RATE_LIMIT_BACKOFF_THRESHOLD = 3;

// ─── Types ───────────────────────────────────────────────────────

interface BridgedRow {
  id: string;
  bsky_at_uri: string;
  bsky_did: string;
  bsky_handle: string | null;
  author_followers_count: number | null;
  indexed_at: Date;
}

interface AppViewAuthor {
  did?: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

interface AppViewPost {
  uri?: string;
  author?: AppViewAuthor;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}

interface GetPostsResponse {
  posts?: AppViewPost[];
}

interface AppViewProfile {
  did?: string;
  followersCount?: number;
}

interface GetProfilesResponse {
  profiles?: AppViewProfile[];
}

// Per-row computed state. Built once per tick, then written.
interface RowUpdate {
  row: BridgedRow;
  // null when the post was deleted upstream (uri missing in
  // getPosts response). In that case engagement_polled_at advances
  // but engagement counts stay untouched.
  engagement: {
    likeCount: number;
    repostCount: number;
    replyCount: number;
  } | null;
  author: {
    handle: string;
    displayName: string | null;
    avatar: string | null;
    followersCount: number | null;
  } | null;
  newState: 'pending' | 'mirrored' | 'declined';
}

// ─── Hot-reload-safe singleton state ─────────────────────────────

type PollerGlobals = {
  __bskyEngagementPoller?: BskyEngagementPoller;
};
const g = globalThis as PollerGlobals;

// ─── SQL ─────────────────────────────────────────────────────────

const SELECT_BATCH_SQL = `
  SELECT id,
         bsky_at_uri,
         bsky_did,
         bsky_handle,
         author_followers_count,
         indexed_at
    FROM bridged_posts
   WHERE mirror_state = 'pending'
   ORDER BY COALESCE(engagement_polled_at, indexed_at) ASC
   LIMIT ${BATCH_SIZE}
`;

// $1=like_count, $2=repost_count, $3=reply_count,
// $4=bsky_handle, $5=bsky_display_name, $6=bsky_avatar_url,
// $7=author_followers_count, $8=mirror_state, $9=id
const UPDATE_FULL_SQL = `
  UPDATE bridged_posts
     SET like_count = $1,
         repost_count = $2,
         reply_count = $3,
         bsky_handle = COALESCE($4, bsky_handle),
         bsky_display_name = COALESCE($5, bsky_display_name),
         bsky_avatar_url = COALESCE($6, bsky_avatar_url),
         author_followers_count = COALESCE($7, author_followers_count),
         engagement_polled_at = NOW(),
         mirror_state = $8
   WHERE id = $9
`;

// Upstream-deleted variant: don't overwrite engagement counts; only
// advance engagement_polled_at and (possibly) flip mirror_state.
// $1=mirror_state, $2=id
const UPDATE_TIMESTAMP_ONLY_SQL = `
  UPDATE bridged_posts
     SET engagement_polled_at = NOW(),
         mirror_state = $1
   WHERE id = $2
`;

// ─── Service ─────────────────────────────────────────────────────

export class BskyEngagementPoller {
  private timer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private consecutiveRateLimits = 0;

  // Tunables (read once at construct; re-read on hot reload).
  private readonly minLikes: number;
  private readonly minReposts: number;
  private readonly minFollowers: number;
  private readonly declineAfterDays: number;
  private readonly pollIntervalSec: number;

  // Injectable for unit tests.
  constructor(
    private readonly db: typeof query = query,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly nowFn: () => Date = () => new Date(),
  ) {
    this.minLikes = readPositiveInt('BSKY_MIN_LIKES', DEFAULT_MIN_LIKES);
    this.minReposts = readPositiveInt('BSKY_MIN_REPOSTS', DEFAULT_MIN_REPOSTS);
    this.minFollowers = readPositiveInt('BSKY_MIN_FOLLOWERS', DEFAULT_MIN_FOLLOWERS);
    this.declineAfterDays = readPositiveInt('BSKY_DECLINE_AFTER_DAYS', DEFAULT_DECLINE_AFTER_DAYS);
    this.pollIntervalSec = readPositiveInt('BSKY_POLL_INTERVAL_SEC', DEFAULT_POLL_INTERVAL_SEC);
  }

  start(): void {
    this.stopRequested = false;
    console.log(
      `[BskyEngagementPoller] started (interval=${this.pollIntervalSec}s, ` +
        `thresholds: likes>=${this.minLikes} OR reposts>=${this.minReposts} OR ` +
        `followers>=${this.minFollowers}; decline_after=${this.declineAfterDays}d)`
    );
    // Fire one tick on boot so we don't wait the full interval to
    // see signs of life. Errors swallowed inside runOnce.
    void this.tick();
  }

  stop(): void {
    this.stopRequested = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[BskyEngagementPoller] stopped');
  }

  // Schedules the next tick. Public to be testable but the test
  // suite drives runOnce() directly to avoid timer interactions.
  private scheduleNext(): void {
    if (this.stopRequested) return;
    if (this.timer) return;
    let delayMs = this.pollIntervalSec * 1000;
    if (this.consecutiveRateLimits >= RATE_LIMIT_BACKOFF_THRESHOLD) {
      delayMs = delayMs * 2;
      console.warn(
        `[BskyEngagementPoller] back-off active (consecutive 429s=${this.consecutiveRateLimits}); ` +
          `next tick in ${delayMs}ms`
      );
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      // runOnce() itself swallows; this is belt-and-braces against
      // anything that escapes (e.g., logger throwing).
      console.error('[BskyEngagementPoller] unexpected tick error:', err);
    } finally {
      this.scheduleNext();
    }
  }

  // Single bounded batch. Public so unit tests can drive it
  // synchronously. Never throws — all errors are logged + swallowed.
  async runOnce(): Promise<void> {
    let rows: BridgedRow[];
    try {
      rows = await this.db<BridgedRow>(SELECT_BATCH_SQL);
    } catch (err) {
      console.error('[BskyEngagementPoller] SELECT failed:', err);
      return;
    }

    if (rows.length === 0) {
      console.log('[BskyEngagementPoller] tick: no work');
      return;
    }

    // 1. Resolve engagement via getPosts.
    const uris = rows.map((r) => r.bsky_at_uri);
    let getPostsRes: GetPostsResponse;
    try {
      getPostsRes = await this.callGetPosts(uris);
    } catch (err) {
      // Logged inside callGetPosts; just bail.
      return;
    }
    const postByUri = new Map<string, AppViewPost>();
    for (const p of getPostsRes.posts ?? []) {
      if (p.uri) postByUri.set(p.uri, p);
    }

    // 2. Decide which DIDs need a profile fetch (no follower count
    //    yet). Author handle/displayName/avatar come from getPosts;
    //    follower count requires getProfiles.
    const didsNeedingProfile = new Set<string>();
    for (const row of rows) {
      const post = postByUri.get(row.bsky_at_uri);
      if (!post) continue;
      if (row.author_followers_count == null) {
        didsNeedingProfile.add(row.bsky_did);
      }
    }
    let getProfilesRes: GetProfilesResponse = { profiles: [] };
    if (didsNeedingProfile.size > 0) {
      try {
        getProfilesRes = await this.callGetProfiles(Array.from(didsNeedingProfile));
      } catch (err) {
        return;
      }
    }
    const followersByDid = new Map<string, number>();
    for (const p of getProfilesRes.profiles ?? []) {
      if (p.did && typeof p.followersCount === 'number') {
        followersByDid.set(p.did, p.followersCount);
      }
    }

    // 3. Compute per-row updates + state transitions.
    const declineCutoffMs =
      this.nowFn().getTime() - this.declineAfterDays * 24 * 60 * 60 * 1000;
    const updates: RowUpdate[] = [];
    let promoted = 0;
    let declined = 0;
    let deletedUpstream = 0;
    for (const row of rows) {
      const post = postByUri.get(row.bsky_at_uri);
      if (!post) {
        deletedUpstream += 1;
        // Upstream-deleted: stay pending (or decline if old enough).
        // Don't touch engagement counts.
        const indexedAtMs = new Date(row.indexed_at).getTime();
        const newState: 'pending' | 'declined' =
          indexedAtMs < declineCutoffMs ? 'declined' : 'pending';
        if (newState === 'declined') declined += 1;
        updates.push({ row, engagement: null, author: null, newState });
        continue;
      }
      const likeCount = post.likeCount ?? 0;
      const repostCount = post.repostCount ?? 0;
      const replyCount = post.replyCount ?? 0;
      const followers =
        followersByDid.get(row.bsky_did) ?? row.author_followers_count ?? null;
      const promotes =
        likeCount >= this.minLikes ||
        repostCount >= this.minReposts ||
        (followers != null && followers >= this.minFollowers);
      const indexedAtMs = new Date(row.indexed_at).getTime();
      const isOld = indexedAtMs < declineCutoffMs;
      let newState: 'pending' | 'mirrored' | 'declined' = 'pending';
      if (promotes) {
        newState = 'mirrored';
        promoted += 1;
      } else if (isOld) {
        newState = 'declined';
        declined += 1;
      }
      updates.push({
        row,
        engagement: { likeCount, repostCount, replyCount },
        author: {
          handle: post.author?.handle ?? '',
          displayName: post.author?.displayName ?? null,
          avatar: post.author?.avatar ?? null,
          followersCount: followers,
        },
        newState,
      });
    }

    // 4. Write each update. Bounded at BATCH_SIZE; per-row
    //    round-trip is fine. (Postgres pool keeps a warm
    //    connection.)
    for (const u of updates) {
      try {
        if (u.engagement && u.author) {
          await this.db(UPDATE_FULL_SQL, [
            u.engagement.likeCount,
            u.engagement.repostCount,
            u.engagement.replyCount,
            u.author.handle || null,
            u.author.displayName,
            u.author.avatar,
            u.author.followersCount,
            u.newState,
            u.row.id,
          ]);
        } else {
          // Upstream-deleted: only advance engagement_polled_at +
          // (possibly) flip mirror_state.
          await this.db(UPDATE_TIMESTAMP_ONLY_SQL, [u.newState, u.row.id]);
        }
      } catch (err) {
        console.error(
          `[BskyEngagementPoller] UPDATE failed for ${u.row.bsky_at_uri}:`,
          err
        );
      }
    }

    // Successful tick → reset rate-limit back-off counter.
    this.consecutiveRateLimits = 0;

    console.log(
      `[BskyEngagementPoller] tick: polled=${rows.length}, promoted=${promoted}, ` +
        `declined=${declined}, deleted_upstream=${deletedUpstream}`
    );
  }

  // ─── HTTP helpers ───────────────────────────────────────────────

  private async callGetPosts(uris: string[]): Promise<GetPostsResponse> {
    // app.bsky.feed.getPosts accepts repeated `uris` query params.
    const params = new URLSearchParams();
    for (const u of uris) params.append('uris', u);
    const url = `${PUBLIC_APPVIEW_BASE}${GET_POSTS_PATH}?${params.toString()}`;
    return this.callAppView<GetPostsResponse>(url, 'getPosts');
  }

  private async callGetProfiles(actors: string[]): Promise<GetProfilesResponse> {
    const params = new URLSearchParams();
    for (const a of actors) params.append('actors', a);
    const url = `${PUBLIC_APPVIEW_BASE}${GET_PROFILES_PATH}?${params.toString()}`;
    return this.callAppView<GetProfilesResponse>(url, 'getProfiles');
  }

  private async callAppView<T>(url: string, label: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch (err) {
      console.warn(`[BskyEngagementPoller] ${label} network error:`, err);
      throw err;
    }
    if (res.status === 429) {
      this.consecutiveRateLimits += 1;
      console.warn(
        `[BskyEngagementPoller] ${label} rate-limited (429); ` +
          `consecutive=${this.consecutiveRateLimits}`
      );
      throw new Error(`${label} rate-limited`);
    }
    if (!res.ok) {
      console.warn(`[BskyEngagementPoller] ${label} HTTP ${res.status}`);
      throw new Error(`${label} HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function readPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

// ─── Hot-reload-safe singleton export ───────────────────────────

if (g.__bskyEngagementPoller) {
  // Watcher reload path: stop the previous instance before
  // dropping the reference. Otherwise old timer + back-off state
  // pile up across reloads.
  try {
    g.__bskyEngagementPoller.stop();
  } catch {
    // ignore
  }
}
const instance = new BskyEngagementPoller();
g.__bskyEngagementPoller = instance;

export const bskyEngagementPoller: BskyEngagementPoller = instance;
