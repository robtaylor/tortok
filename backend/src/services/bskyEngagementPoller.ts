// Phase 3 Unit 2.5D: the bridge's engagement poller (Decision 0023 items 1,
// 3, 4 and 5). Re-reads bridged posts from Bluesky's public AppView in
// batches of 25 (app.bsky.feed.getPosts) and their authors
// (app.bsky.actor.getProfiles), and on each check:
//
// 1. stores every post and author label in `labels`, and the author in
//    `bridge_authors`;
// 2. deletes the row if the post is gone from the AppView (deleted, taken
//    down, or hidden from logged-out viewers) or labelled NSFW, and every
//    bridged row by an excluded author (bridgePolicy.ts), due or not;
// 3. otherwise qualifies it for the feed once it meets an engagement
//    threshold, or deletes it if it hasn't within `qualifyDays`.
//
// Checks follow a decaying schedule, half the post's age clamped to 15
// minutes..24 hours, so a post gets about 14 checks over its first week
// rather than one every few minutes. Qualified posts stay on the daily
// schedule, so later labels and deletions still reach them, until they are
// `recheckDays` old; after that a row goes only on a Jetstream delete, or
// when its author is found excluded.

import { bridgeNsfwLabels, bridgeThresholds, envNumber } from '../config';
import type { BridgeThresholds } from '../config';
import { query as defaultQuery } from '../db';
import type { QueryFn } from '../db';
import type { FetchFn } from '../atproto/identity';
import { BSKY_POST_NSID } from '../atproto/bskyPost';
import { accountSubjects, replaceSelfLabels, upsertLabels, viewLabels } from '../atproto/labels';
import { isObject } from '../atproto/videoPost';
import { authorExcluded, deleteBridged, deleteBridgedBy, postExcluded, saysNoBridge } from './bridgePolicy';

const DEFAULT_APPVIEW = 'https://public.api.bsky.app';
/** getPosts and getProfiles both take at most 25. */
const BATCH = 25;
const DAY_MS = 24 * 60 * 60_000;
const MIN_DELAY_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** How long until a post of this age is checked again. */
export function nextCheckDelayMs(ageMs: number): number {
  return Math.min(DAY_MS, Math.max(MIN_DELAY_MS, ageMs / 2));
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

export class AppViewError extends Error {
  constructor(readonly method: string, readonly status: number) {
    super(`${method} returned ${status}`);
    this.name = 'AppViewError';
  }
}

export interface PollerOptions {
  db?: QueryFn;
  fetch?: FetchFn;
  /** Bluesky AppView base URL. */
  appviewUrl?: string;
  thresholds?: BridgeThresholds;
  nsfwLabels?: ReadonlySet<string>;
  /** Pause between batches when the queue isn't full. */
  tickMs?: number;
  /** Age after which a qualified post is no longer re-checked. */
  recheckDays?: number;
  now?: () => Date;
}

interface DueRow {
  at_uri: string;
  did: string;
  record_created_at: Date;
  bridge_qualified_at: Date | null;
}

export interface BatchResult {
  /** Due posts read from the AppView. */
  checked: number;
  qualified: number;
  /** Rows deleted: checked posts, and every other bridged post by an author found excluded. */
  dropped: number;
}

export class BskyEngagementPoller {
  private readonly db: QueryFn;
  private readonly fetch: FetchFn;
  private readonly appviewUrl: string;
  private readonly t: BridgeThresholds;
  private readonly nsfwLabels: ReadonlySet<string>;
  private readonly tickMs: number;
  private readonly recheckMs: number;
  private readonly now: () => Date;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> = Promise.resolve();
  private failures = 0;

  constructor(opts: PollerOptions = {}) {
    this.db = opts.db ?? defaultQuery;
    this.fetch = opts.fetch ?? fetch;
    this.appviewUrl = opts.appviewUrl ?? DEFAULT_APPVIEW;
    this.t = opts.thresholds ?? bridgeThresholds();
    this.nsfwLabels = opts.nsfwLabels ?? bridgeNsfwLabels();
    this.tickMs = opts.tickMs ?? 15_000;
    this.recheckMs = (opts.recheckDays ?? envNumber('BRIDGE_RECHECK_DAYS', 30)) * DAY_MS;
    this.now = opts.now ?? (() => new Date());
  }

  start(): void {
    this.stopped = false;
    const { minLikes, minReposts, minFollowers, qualifyDays } = this.t;
    console.log(`[poller] started: ${minLikes} likes, ${minReposts} reposts or ${minFollowers} followers within ${qualifyDays} days`);
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let delay = this.tickMs;
    try {
      const r = await this.runOnce();
      this.failures = 0;
      if (r.checked > 0) console.log(`[poller] checked=${r.checked} qualified=${r.qualified} dropped=${r.dropped}`);
      // A full batch means more are due: carry on without the pause.
      if (r.checked === BATCH) delay = 1_000;
    } catch (err) {
      this.failures++;
      delay = Math.min(this.tickMs * 2 ** this.failures, BACKOFF_MAX_MS);
      console.warn(`[poller] batch failed (${(err as Error).message}); retrying in ${Math.round(delay / 1000)} s`);
    }
    this.schedule(delay);
  }

  /** Check one batch of due posts. Public so tests can drive it. Throws on AppView or database errors. */
  async runOnce(): Promise<BatchResult> {
    const now = this.now();
    // The collection is a literal so the planner matches the partial index.
    const rows = await this.db<DueRow>(
      `SELECT at_uri, did, record_created_at, bridge_qualified_at FROM posts
        WHERE collection = '${BSKY_POST_NSID}' AND bridge_next_check_at <= $1
        ORDER BY bridge_next_check_at
        LIMIT ${BATCH}`,
      [now]);
    const result: BatchResult = { checked: rows.length, qualified: 0, dropped: 0 };
    if (rows.length === 0) return result;

    const dids = [...new Set(rows.map((r) => r.did))];
    const [postList, followers] = await Promise.all([
      this.xrpcList('app.bsky.feed.getPosts', 'uris', rows.map((r) => r.at_uri), 'posts'),
      this.refreshAuthors(dids, now),
    ]);
    const posts = new Map(postList.filter((p) => typeof p.uri === 'string').map((p) => [p.uri as string, p]));

    // The post's labels, and its author's as getPosts shows them, so an
    // opt-out or account label added since the last profile refresh counts
    // now. (Removals wait for the profile refresh, which replaces the set.)
    await upsertLabels(this.db, [...posts.values()].flatMap((p) =>
      [...viewLabels(p.labels), ...viewLabels(isObject(p.author) ? p.author.labels : undefined)]));
    const excluded = new Set<string>();
    for (const did of dids) if (await authorExcluded(this.db, did, this.nsfwLabels)) excluded.add(did);
    // An excluded author's bridged posts all go (Decision 0023 item 4), not
    // only the ones due now: the rest would stay in the feed until their own
    // checks, and for good once past recheckMs.
    result.dropped += await deleteBridgedBy(this.db, [...excluded]);

    for (const row of rows) {
      if (excluded.has(row.did)) continue;
      const post = posts.get(row.at_uri);
      const age = now.getTime() - row.record_created_at.getTime();
      let qualifiedAt = row.bridge_qualified_at;
      if (post && !qualifiedAt && this.meetsThreshold(post, followers.get(row.did) ?? 0)) qualifiedAt = now;
      const keep = post !== undefined
        && !(await postExcluded(this.db, row.at_uri, this.nsfwLabels))
        && (qualifiedAt !== null || age <= this.t.qualifyDays * DAY_MS);
      if (!keep) {
        await deleteBridged(this.db, row.at_uri);
        result.dropped++;
        continue;
      }
      if (qualifiedAt === now) result.qualified++;
      const next = qualifiedAt && age > this.recheckMs ? null : new Date(now.getTime() + nextCheckDelayMs(age));
      await this.db(
        `UPDATE posts SET bridge_checked_at = $2, bridge_next_check_at = $3, bridge_qualified_at = $4
          WHERE at_uri = $1`,
        [row.at_uri, now, next, qualifiedAt]);
    }
    return result;
  }

  private meetsThreshold(post: Record<string, unknown>, followers: number): boolean {
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    return n(post.likeCount) >= this.t.minLikes
      || n(post.repostCount) >= this.t.minReposts
      || followers >= this.t.minFollowers;
  }

  /**
   * Refresh `bridge_authors` and author labels for authors not refreshed in
   * the last day, and return every author's follower count. An author the
   * AppView doesn't return keeps their old row.
   */
  private async refreshAuthors(dids: string[], now: Date): Promise<Map<string, number>> {
    const known = await this.db<{ did: string; followers_count: number | null; refreshed_at: Date }>(
      'SELECT did, followers_count, refreshed_at FROM bridge_authors WHERE did = ANY($1)', [dids]);
    const followers = new Map(known.map((a) => [a.did, a.followers_count ?? 0]));
    const fresh = new Set(known.filter((a) => now.getTime() - a.refreshed_at.getTime() < DAY_MS).map((a) => a.did));
    const stale = new Set(dids.filter((d) => !fresh.has(d)));
    if (stale.size === 0) return followers;

    for (const p of await this.xrpcList('app.bsky.actor.getProfiles', 'actors', [...stale], 'profiles')) {
      const did = p.did;
      if (typeof did !== 'string' || !stale.has(did)) continue;
      const labels = viewLabels(p.labels);
      // Self-labels are a set the author replaces; keep that set exact, on
      // each subject an account's labels can have.
      for (const subject of accountSubjects(did)) {
        await replaceSelfLabels(this.db, subject, did, labels.filter((l) => l.src === did && l.subject === subject));
      }
      await upsertLabels(this.db, labels.filter((l) => l.src !== did));
      const handle = str(p.handle);
      const count = typeof p.followersCount === 'number' ? p.followersCount : null;
      await this.db(
        `INSERT INTO bridge_authors (did, handle, display_name, avatar_url, followers_count, nobridge, refreshed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (did) DO UPDATE SET
           handle = EXCLUDED.handle, display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url,
           followers_count = EXCLUDED.followers_count, nobridge = EXCLUDED.nobridge,
           refreshed_at = EXCLUDED.refreshed_at`,
        [did, handle === 'handle.invalid' ? null : handle, str(p.displayName), str(p.avatar), count,
          saysNoBridge(str(p.description), str(p.displayName)), now]);
      followers.set(did, count ?? 0);
    }
    return followers;
  }

  /** GET an AppView list method with a repeated parameter; returns the objects in `key`. */
  private async xrpcList(method: string, param: string, values: string[], key: string): Promise<Record<string, unknown>[]> {
    const url = new URL(`/xrpc/${method}`, this.appviewUrl);
    for (const v of values) url.searchParams.append(param, v);
    const res = await this.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new AppViewError(method, res.status);
    const body: unknown = await res.json();
    const list = isObject(body) ? body[key] : undefined;
    return Array.isArray(list) ? list.filter(isObject) : [];
  }
}

/** Build the poller from the environment: `BRIDGE_APPVIEW_URL`, the thresholds and `BRIDGE_NSFW_LABELS`. */
export function bskyEngagementPollerFromEnv(): BskyEngagementPoller {
  return new BskyEngagementPoller({ appviewUrl: process.env.BRIDGE_APPVIEW_URL || undefined });
}
