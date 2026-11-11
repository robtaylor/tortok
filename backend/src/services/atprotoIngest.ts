// Phase 3 Unit 2.5A: index `app.tortok.video.post` records from the network
// into `posts` (Decision 0017: the AppView's Postgres is a rebuildable index).
//
// - Live: Jetstream, filtered server-side to our collection, so records from
//   every PDS on the relay arrive as create/update/delete events. The cursor
//   is saved every few seconds and rewound a little on reconnect; upserts are
//   idempotent, so the replay is harmless.
// - Backfill: `com.atproto.repo.listRecords` for every known account on boot,
//   then rows the listing no longer contains are deleted.
// - Authors come from their DID document and PDS (identity.ts), cached in
//   `profiles` and refreshed when stale.
//
// `ingest_cursor` and `known_accounts` are operator-local: a rebuild from
// the network needs them (Decision 0017 item 2).

import WebSocket from 'ws';
import { query as defaultQuery } from '../db';
import { IdentityResolver, isDid } from '../atproto/identity';
import type { FetchFn, Profile } from '../atproto/identity';
import { InvalidRecordError, parseVideoPost, VIDEO_POST_NSID } from '../atproto/videoPost';

export type QueryFn = typeof defaultQuery;

/** The subset of the `ws` WebSocket API the service uses (tests fake it). */
export interface WebSocketLike {
  on(event: 'open', cb: () => void): unknown;
  on(event: 'message', cb: (data: WebSocket.RawData) => void): unknown;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  close(): void;
}

export interface IngestOptions {
  db?: QueryFn;
  fetch?: FetchFn;
  identity?: IdentityResolver;
  wsFactory?: (url: string) => WebSocketLike;
  /** Jetstream subscribe endpoint, without query string. */
  jetstreamUrl?: string;
  /** DIDs to backfill even before Jetstream has shown them posting. */
  seedDids?: string[];
  profileMaxAgeMs?: number;
  cursorFlushMs?: number;
  backfillConcurrency?: number;
}

interface JetstreamEvent {
  did?: string;
  time_us?: number;
  kind?: string;
  commit?: {
    operation?: string;
    collection?: string;
    rkey?: string;
    cid?: string;
    record?: unknown;
  };
}

const DEFAULT_JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';
const CURSOR_KEY = 'jetstream';
/** Rewind on reconnect, in Jetstream's microseconds. */
const CURSOR_REWIND_US = 5_000_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const RKEY_RE = /^[A-Za-z0-9._:~-]{1,512}$/;

const postUri = (did: string, rkey: string) => `at://${did}/${VIDEO_POST_NSID}/${rkey}`;

const UPSERT_POST_SQL = `
  INSERT INTO posts (
    at_uri, did, collection, rkey, cid, text, thumbnail_cid, duration_ms,
    width, height, hashtags, magnet_link, info_hash, torrent_cid, record_created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  ON CONFLICT (at_uri) DO UPDATE SET
    cid = EXCLUDED.cid, text = EXCLUDED.text, thumbnail_cid = EXCLUDED.thumbnail_cid,
    duration_ms = EXCLUDED.duration_ms, width = EXCLUDED.width, height = EXCLUDED.height,
    hashtags = EXCLUDED.hashtags, magnet_link = EXCLUDED.magnet_link,
    info_hash = EXCLUDED.info_hash, torrent_cid = EXCLUDED.torrent_cid,
    record_created_at = EXCLUDED.record_created_at, indexed_at = NOW()
  WHERE posts.cid IS DISTINCT FROM EXCLUDED.cid
`;

const UPSERT_PROFILE_SQL = `
  INSERT INTO profiles (did, handle, display_name, avatar_cid, pds_endpoint, refreshed_at)
  VALUES ($1, $2, $3, $4, $5, NOW())
  ON CONFLICT (did) DO UPDATE SET
    handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
    avatar_cid = EXCLUDED.avatar_cid, pds_endpoint = EXCLUDED.pds_endpoint,
    refreshed_at = NOW()
`;

export class AtprotoIngest {
  private readonly db: QueryFn;
  private readonly fetch: FetchFn;
  private readonly identity: IdentityResolver;
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly jetstreamUrl: string;
  private readonly seedDids: string[];
  private readonly profileMaxAgeMs: number;
  private readonly cursorFlushMs: number;
  private readonly backfillConcurrency: number;

  private ws: WebSocketLike | null = null;
  /** Set by stop(). backfill() can also run without start(), so it starts false. */
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private flushTimer: NodeJS.Timeout | null = null;
  private cursor: number | null = null;
  private savedCursor: number | null = null;
  /** Events are handled one at a time, in order, so the cursor only moves forward. */
  private queue: Promise<void> = Promise.resolve();
  private readonly known = new Set<string>();
  private readonly profileRefreshes = new Map<string, Promise<void>>();
  /** When each profile was last written, so fresh ones skip the database. */
  private readonly profileRefreshedAt = new Map<string, number>();
  private backfillRun: Promise<void> = Promise.resolve();

  constructor(opts: IngestOptions = {}) {
    this.db = opts.db ?? defaultQuery;
    this.fetch = opts.fetch ?? fetch;
    this.identity = opts.identity ?? new IdentityResolver({ fetch: this.fetch });
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url));
    this.jetstreamUrl = opts.jetstreamUrl ?? DEFAULT_JETSTREAM_URL;
    this.seedDids = opts.seedDids ?? [];
    this.profileMaxAgeMs = opts.profileMaxAgeMs ?? 24 * 60 * 60 * 1000;
    this.cursorFlushMs = opts.cursorFlushMs ?? 5_000;
    this.backfillConcurrency = opts.backfillConcurrency ?? 4;
    for (const did of this.seedDids) {
      if (!isDid(did)) throw new Error(`seed DID ${did} is not a did:plc or did:web`);
    }
  }

  /** Load state, connect to Jetstream, and start backfilling known accounts. */
  async start(): Promise<void> {
    this.stopped = false;
    const [row] = await this.db<{ cursor: string | null }>(
      'SELECT cursor FROM ingest_cursor WHERE key = $1', [CURSOR_KEY]);
    this.cursor = row?.cursor != null ? Number(row.cursor) : null;
    this.savedCursor = this.cursor;

    for (const did of this.seedDids) await this.addKnownAccount(did, 'seed');
    const rows = await this.db<{ did: string }>('SELECT did FROM known_accounts');
    for (const { did } of rows) this.known.add(did);

    this.connect();
    this.flushTimer = setInterval(() => void this.flushCursor(), this.cursorFlushMs);
    this.backfillRun = this.backfillAll();
    console.log(`[ingest] started: ${this.known.size} known accounts, cursor=${this.cursor ?? 'none'}`);
  }

  /** Disconnect, finish in-flight work and save the cursor. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.reconnectTimer = this.flushTimer = null;
    this.ws?.close();
    this.ws = null;
    await Promise.allSettled([this.queue, this.backfillRun]);
    await this.flushCursor();
    console.log('[ingest] stopped');
  }

  /** Resolves once the boot-time backfill has finished (for tests and logs). */
  whenBackfilled(): Promise<void> {
    return this.backfillRun;
  }

  /** Resolves once in-flight profile refreshes have finished (for tests). */
  async whenProfilesSettled(): Promise<void> {
    await Promise.all(this.profileRefreshes.values());
  }

  // ─── Jetstream ────────────────────────────────────────────────────

  private subscribeUrl(): string {
    const url = new URL(this.jetstreamUrl);
    url.searchParams.set('wantedCollections', VIDEO_POST_NSID);
    if (this.cursor !== null) {
      url.searchParams.set('cursor', String(Math.max(0, this.cursor - CURSOR_REWIND_US)));
    }
    return url.toString();
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocketLike;
    try {
      ws = this.wsFactory(this.subscribeUrl());
    } catch (err) {
      console.error('[ingest] Jetstream connect failed:', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      console.log('[ingest] Jetstream connected');
    });
    ws.on('message', (data) => {
      let event: JetstreamEvent;
      try {
        event = JSON.parse(data.toString());
      } catch {
        console.warn('[ingest] dropped a non-JSON Jetstream message');
        return;
      }
      this.enqueue(event);
    });
    ws.on('error', (err) => console.error('[ingest] Jetstream error:', err.message));
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.stopped) console.warn(`[ingest] Jetstream closed (${code})`);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private enqueue(event: JetstreamEvent): void {
    this.queue = this.queue
      .then(() => this.handleEvent(event))
      .catch((err) => console.error('[ingest] event failed:', err));
  }

  /** Handle one Jetstream event. Public so tests can drive it directly. */
  async handleEvent(event: JetstreamEvent): Promise<void> {
    if (event.kind === 'commit' && event.did && event.commit) {
      await this.handleCommit(event.did, event.commit);
    } else if (event.kind === 'identity' && event.did && this.known.has(event.did)) {
      await this.refreshProfile(event.did, true);
    }
    if (typeof event.time_us === 'number' && (this.cursor === null || event.time_us > this.cursor)) {
      this.cursor = event.time_us;
    }
  }

  private async handleCommit(did: string, commit: NonNullable<JetstreamEvent['commit']>): Promise<void> {
    const { operation, collection, rkey } = commit;
    if (collection !== VIDEO_POST_NSID || !rkey || !RKEY_RE.test(rkey) || !isDid(did)) return;
    if (operation !== 'delete' && operation !== 'create' && operation !== 'update') return;
    if (operation !== 'delete' && !commit.cid) return;

    // A delete, or an edit that makes a record invalid, removes the row.
    if (operation === 'delete' || !(await this.indexRecord(did, rkey, commit.cid!, commit.record))) {
      await this.db('DELETE FROM posts WHERE at_uri = $1', [postUri(did, rkey)]);
      return;
    }

    if (!this.known.has(did)) await this.addKnownAccount(did, 'jetstream');
    // Off the event queue: a slow DID or PDS mustn't hold up other events.
    void this.refreshProfile(did, false);
  }

  /** Validate and upsert one record. Returns false if it was invalid. */
  private async indexRecord(did: string, rkey: string, cid: string, record: unknown): Promise<boolean> {
    let post;
    try {
      post = parseVideoPost(record);
    } catch (err) {
      if (err instanceof InvalidRecordError) {
        console.warn(`[ingest] skipped ${postUri(did, rkey)}: ${err.message}`);
        return false;
      }
      throw err;
    }
    await this.db(UPSERT_POST_SQL, [
      postUri(did, rkey), did, VIDEO_POST_NSID, rkey, cid,
      post.caption, post.thumbnailCid, post.durationMs, post.width, post.height,
      post.hashtags, post.magnetUri, post.infoHash, post.torrentCid, post.createdAt,
    ]);
    return true;
  }

  private async flushCursor(): Promise<void> {
    if (this.cursor === null || this.cursor === this.savedCursor) return;
    const cursor = this.cursor;
    try {
      await this.db(
        `INSERT INTO ingest_cursor (key, cursor, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
        [CURSOR_KEY, cursor]);
      this.savedCursor = cursor;
    } catch (err) {
      console.error('[ingest] saving the cursor failed:', err);
    }
  }

  // ─── Accounts and profiles ────────────────────────────────────────

  private async addKnownAccount(did: string, source: 'seed' | 'jetstream'): Promise<void> {
    await this.db(
      'INSERT INTO known_accounts (did, source) VALUES ($1, $2) ON CONFLICT (did) DO NOTHING',
      [did, source]);
    this.known.add(did);
  }

  private isFresh(refreshedAtMs: number | undefined): boolean {
    return refreshedAtMs !== undefined && Date.now() - refreshedAtMs < this.profileMaxAgeMs;
  }

  private async saveProfile(p: Profile): Promise<void> {
    await this.db(UPSERT_PROFILE_SQL, [p.did, p.handle, p.displayName, p.avatarCid, p.pdsEndpoint]);
    this.profileRefreshedAt.set(p.did, Date.now());
  }

  /** Refresh a profile if it's missing or stale (or always, with force). Never throws. */
  private refreshProfile(did: string, force: boolean): Promise<void> {
    if (!force && this.isFresh(this.profileRefreshedAt.get(did))) return Promise.resolve();
    const inFlight = this.profileRefreshes.get(did);
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        if (!force) {
          const [row] = await this.db<{ refreshed_at: Date }>(
            'SELECT refreshed_at FROM profiles WHERE did = $1', [did]);
          if (row) this.profileRefreshedAt.set(did, row.refreshed_at.getTime());
          if (this.isFresh(row?.refreshed_at.getTime())) return;
        }
        await this.saveProfile(await this.identity.profile(did));
      } catch (err) {
        console.warn(`[ingest] profile refresh for ${did} failed: ${(err as Error).message}`);
      } finally {
        this.profileRefreshes.delete(did);
      }
    })();
    this.profileRefreshes.set(did, run);
    return run;
  }

  // ─── Backfill ─────────────────────────────────────────────────────

  private async backfillAll(): Promise<void> {
    const dids = [...this.known];
    let next = 0;
    const worker = async () => {
      while (!this.stopped && next < dids.length) {
        const did = dids[next++];
        try {
          await this.backfill(did);
        } catch (err) {
          console.warn(`[ingest] backfill of ${did} failed: ${(err as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.backfillConcurrency, dids.length) }, worker));
  }

  /**
   * Re-list one account's records from its PDS, upsert them, and delete rows
   * it no longer has. Rows indexed after the listing started are kept, so a
   * post that arrives on Jetstream mid-backfill isn't deleted.
   */
  async backfill(did: string): Promise<void> {
    const startedAt = new Date();
    // One resolution serves both the PDS endpoint and the profile row.
    const profile = await this.identity.profile(did);
    const { pdsEndpoint } = profile;
    const prefix = postUri(did, '');
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const url = new URL(`${pdsEndpoint}/xrpc/com.atproto.repo.listRecords`);
      url.searchParams.set('repo', did);
      url.searchParams.set('collection', VIDEO_POST_NSID);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await this.fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`listRecords returned ${res.status}`);
      const page = (await res.json()) as { cursor?: string; records?: { uri?: string; cid?: string; value?: unknown }[] };
      for (const r of page.records ?? []) {
        if (typeof r.uri !== 'string' || !r.uri.startsWith(prefix) || typeof r.cid !== 'string') continue;
        const rkey = r.uri.slice(prefix.length);
        if (!RKEY_RE.test(rkey)) continue;
        if (await this.indexRecord(did, rkey, r.cid, r.value)) seen.push(r.uri);
      }
      cursor = page.records?.length ? page.cursor : undefined;
    } while (cursor && !this.stopped);
    if (this.stopped) return;

    await this.db(
      `DELETE FROM posts WHERE did = $1 AND collection = $2
         AND NOT (at_uri = ANY($3)) AND indexed_at < $4`,
      [did, VIDEO_POST_NSID, seen, startedAt]);
    await this.saveProfile(profile);
    console.log(`[ingest] backfilled ${did}: ${seen.length} posts`);
  }
}

/**
 * Build the service from the environment: `JETSTREAM_URL`,
 * `INGEST_SEED_DIDS`, and `PLC_DIRECTORY_URL` (default https://plc.directory;
 * the e2e stack points it at its own PLC).
 */
export function ingestFromEnv(): AtprotoIngest {
  return new AtprotoIngest({
    jetstreamUrl: process.env.JETSTREAM_URL || undefined,
    seedDids: (process.env.INGEST_SEED_DIDS ?? '').split(',').map((d) => d.trim()).filter(Boolean),
    identity: new IdentityResolver({ plcDirectory: process.env.PLC_DIRECTORY_URL || undefined }),
  });
}
