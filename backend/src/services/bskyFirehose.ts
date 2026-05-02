// Phase 3 Unit 2.5 — inbound Bluesky bridge (ADR-010 + ADR-010-A).
//
// Subscribes to Bluesky PBC's Jetstream JSON wrapper around the
// atproto firehose, filters for portrait/square video posts via
// `app.bsky.embed.video`, and indexes matches into `bridged_posts`
// (mirror_state = 'pending').
//
// Why Jetstream and not the raw firehose? The raw `subscribeRepos`
// is CBOR + CAR-encoded; Jetstream emits the same data as plain
// JSON over WebSocket, filtered server-side by collection. Saves a
// dependency tree (no @atproto/sync, no @atproto/repo). See
// `scripts/bsky-video-aspect-sampler.mjs` for the exact protocol
// shape — the parsing/filter logic in this service mirrors the
// sampler's, just with INSERT into postgres instead of a counter.
//
// Author profile fields (handle, display name, avatar, follower
// count) are NOT in the firehose record — they live on the
// separate `app.bsky.actor.profile` record. We insert `bsky_did`
// only here; the engagement poller (next slice) will resolve the
// rest via `app.bsky.actor.getProfile`.
//
// Author opt-out (`!no-bridge` self-label) and labeler-driven
// filtering are deferred to the moderation track per the Unit 2.5
// brief: the column is wired (`author_excluded` always-false here)
// but the actual check is stubbed.
import { query } from '../db';

// ─── Types ───────────────────────────────────────────────────────

interface JetstreamAspectRatio {
  width?: number;
  height?: number;
}

interface JetstreamBlobRef {
  $link?: string;
}

interface JetstreamVideoEmbed {
  $type?: string;
  video?: {
    ref?: JetstreamBlobRef;
    mimeType?: string;
    size?: number;
  };
  aspectRatio?: JetstreamAspectRatio;
}

interface JetstreamPostRecord {
  $type?: string;
  text?: string;
  createdAt?: string;
  embed?: JetstreamVideoEmbed;
}

interface JetstreamCommit {
  rev?: string;
  operation?: string;
  collection?: string;
  rkey?: string;
  record?: JetstreamPostRecord;
  cid?: string;
}

interface JetstreamEvent {
  did?: string;
  time_us?: number;
  kind?: string;
  commit?: JetstreamCommit;
}

// ─── Constants ───────────────────────────────────────────────────

// Jetstream JSON wrapper (Bluesky PBC).
// Server-side filtered to `app.bsky.feed.post`.
const JETSTREAM_BASE_URL =
  'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

// Default reject horizontal videos. Tuneable per ADR-010-A; see
// BSKY_ASPECT_MIN env var note in `.env.example`.
const DEFAULT_ASPECT_MIN = 1.0;

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// ─── Hot-reload-safe singleton state ─────────────────────────────
//
// `ts-node-dev --respawn` (and similar watchers) re-import this
// module on save. Without a guard, each save would spawn a new
// WebSocket on top of the prior one. Stash the live instance on
// globalThis so subsequent imports reuse it. Mirror of the bridge
// registry pattern in `tortok/lib/webtorrent/bridge.native.ts`.

type FirehoseGlobals = {
  __bskyFirehose?: BskyFirehoseService;
};
const g = globalThis as FirehoseGlobals;

// ─── Filter chain ────────────────────────────────────────────────
//
// Cheapest rejection first. Identical ordering to the sampler.
// Returns null on reject; on accept returns the parsed bits the
// INSERT path needs.

export interface FilteredVideoEvent {
  atUri: string;
  did: string;
  rkey: string;
  text: string | null;
  videoCid: string;
  videoBskyPlaylistUrl: string;
  width: number;
  height: number;
  aspectRatioW: number;
  aspectRatioH: number;
  recordCreatedAt: string | null;
  cursor: string | null;
}

export function filterEvent(
  event: JetstreamEvent,
  aspectMin: number = DEFAULT_ASPECT_MIN
): FilteredVideoEvent | null {
  if (event.kind !== 'commit') return null;
  if (event.commit?.operation !== 'create') return null;
  if (event.commit.collection !== 'app.bsky.feed.post') return null;

  const embed = event.commit.record?.embed;
  if (embed?.$type !== 'app.bsky.embed.video') return null;

  // No aspectRatio → reject. A vertical feed cannot render an
  // unsized video; same call the sampler makes (no_aspect bucket
  // is rejected, not accepted).
  const ar = embed.aspectRatio;
  if (!ar?.width || !ar.height) return null;

  const ratio = ar.height / ar.width;
  if (ratio < aspectMin) return null;

  // Author opt-out check is stubbed (always-false) in this slice.
  // The `author_excluded` column is wired so the next slice can
  // populate it; we don't enforce it here yet.

  // Required identity fields. Bail if Jetstream sent something
  // structurally weird.
  const did = event.did;
  const rkey = event.commit.rkey;
  const videoCid = embed.video?.ref?.$link;
  if (!did || !rkey || !videoCid) return null;

  const atUri = `at://${did}/app.bsky.feed.post/${rkey}`;
  // Per ADR-010: Bluesky's HLS playlist URL convention.
  const videoBskyPlaylistUrl =
    `https://video.bsky.app/watch/${did}/${videoCid}/playlist.m3u8`;

  return {
    atUri,
    did,
    rkey,
    text: event.commit.record?.text ?? null,
    videoCid,
    videoBskyPlaylistUrl,
    width: ar.width,
    height: ar.height,
    aspectRatioW: ar.width,
    aspectRatioH: ar.height,
    recordCreatedAt: event.commit.record?.createdAt ?? null,
    cursor: event.time_us !== undefined ? String(event.time_us) : null,
  };
}

// ─── INSERT + cursor persistence ─────────────────────────────────

const INSERT_SQL = `
  INSERT INTO bridged_posts (
    bsky_at_uri,
    bsky_did,
    text,
    video_cid,
    video_bsky_playlist_url,
    width,
    height,
    aspect_ratio_w,
    aspect_ratio_h,
    record_created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (bsky_at_uri) DO NOTHING
`;

const UPDATE_CURSOR_SQL = `
  UPDATE bridge_cursor
     SET cursor = $1, updated_at = NOW()
   WHERE key = 'jetstream'
`;

const SELECT_CURSOR_SQL = `
  SELECT cursor FROM bridge_cursor WHERE key = 'jetstream'
`;

const ENSURE_CURSOR_ROW_SQL = `
  INSERT INTO bridge_cursor (key, cursor, updated_at)
  VALUES ('jetstream', NULL, NOW())
  ON CONFLICT (key) DO NOTHING
`;

// ─── Service ─────────────────────────────────────────────────────

export class BskyFirehoseService {
  private ws: WebSocket | null = null;
  private stopRequested = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private cursor: string | null = null;
  private aspectMin: number;

  // Injectable for the unit test (default uses real `query`).
  constructor(
    private readonly db: typeof query = query,
    private readonly wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    const envVal = process.env.BSKY_ASPECT_MIN;
    const parsed = envVal !== undefined ? Number(envVal) : NaN;
    this.aspectMin = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASPECT_MIN;
  }

  async start(): Promise<void> {
    this.stopRequested = false;
    await this.db(ENSURE_CURSOR_ROW_SQL);
    const rows = await this.db<{ cursor: string | null }>(SELECT_CURSOR_SQL);
    this.cursor = rows[0]?.cursor ?? null;
    this.connect();
    console.log(
      `[BskyFirehose] started (aspect_min=${this.aspectMin}, cursor=${this.cursor ?? '<none>'})`
    );
  }

  stop(): void {
    this.stopRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    console.log('[BskyFirehose] stopped');
  }

  private buildUrl(): string {
    if (!this.cursor) return JETSTREAM_BASE_URL;
    return `${JETSTREAM_BASE_URL}&cursor=${encodeURIComponent(this.cursor)}`;
  }

  private connect(): void {
    if (this.stopRequested) return;
    const url = this.buildUrl();
    let ws: WebSocket;
    try {
      ws = this.wsFactory(url);
    } catch (err) {
      console.error('[BskyFirehose] WS construct failed:', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      console.log(`[BskyFirehose] connected (cursor=${this.cursor ?? '<none>'})`);
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    });

    ws.addEventListener('message', (msg: MessageEvent) => {
      void this.handleMessage(msg);
    });

    ws.addEventListener('error', (e: Event) => {
      const detail = (e as { message?: string }).message ?? '(no detail)';
      console.error(`[BskyFirehose] WS error: ${detail}`);
    });

    ws.addEventListener('close', (e: Event) => {
      const closeDetail = e as { code?: number; reason?: string };
      console.warn(
        `[BskyFirehose] WS closed: ${closeDetail.code ?? '?'} ${closeDetail.reason ?? ''}`
      );
      this.ws = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopRequested) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    console.log(`[BskyFirehose] reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
      this.connect();
    }, delay);
  }

  // Exposed (via `_handleMessageForTest`) for unit testing the
  // filter chain + INSERT path without standing up a real WS.
  async handleMessage(msg: { data: unknown }): Promise<void> {
    let event: JetstreamEvent;
    try {
      const text =
        typeof msg.data === 'string'
          ? msg.data
          : new TextDecoder().decode(msg.data as ArrayBuffer);
      event = JSON.parse(text);
    } catch {
      return;
    }

    const filtered = filterEvent(event, this.aspectMin);
    if (!filtered) return;

    try {
      await this.db(INSERT_SQL, [
        filtered.atUri,
        filtered.did,
        filtered.text,
        filtered.videoCid,
        filtered.videoBskyPlaylistUrl,
        filtered.width,
        filtered.height,
        filtered.aspectRatioW,
        filtered.aspectRatioH,
        filtered.recordCreatedAt,
      ]);

      // Persist cursor AFTER successful insert. Restart correctness
      // invariant: a crash mid-insert replays the event next boot;
      // dedup is handled by the UNIQUE(bsky_at_uri) + ON CONFLICT.
      if (filtered.cursor) {
        this.cursor = filtered.cursor;
        await this.db(UPDATE_CURSOR_SQL, [filtered.cursor]);
      }
    } catch (err) {
      console.error('[BskyFirehose] INSERT failed:', err);
    }
  }
}

// ─── Hot-reload-safe singleton export ───────────────────────────

if (g.__bskyFirehose) {
  // Watcher reload path: stop the previous instance before
  // dropping the reference. Otherwise the old WebSocket lingers
  // and we pile up duplicated subscriptions on every save.
  try {
    g.__bskyFirehose.stop();
  } catch {
    // ignore
  }
}
const instance = new BskyFirehoseService();
g.__bskyFirehose = instance;

export const bskyFirehose: BskyFirehoseService = instance;
