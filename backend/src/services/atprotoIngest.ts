// Phase 3 Unit 2.5A: index `app.tortok.video.post` records from the network
// into `posts` (Decision 0017: the AppView's Postgres is a rebuildable index).
//
// - Live: Jetstream (jetstream.ts), filtered server-side to our collection,
//   so records from every PDS on the relay arrive as create/update/delete
//   events. Upserts are idempotent, so the replay after a reconnect is
//   harmless.
// - Backfill: `com.atproto.repo.listRecords` for every known account on boot,
//   then rows the listing no longer contains are deleted.
// - Authors come from their DID document and PDS (identity.ts), cached in
//   `profiles` and refreshed when stale.
//
// `ingest_cursor` and `known_accounts` are operator-local: a rebuild from
// the network needs them (Decision 0017 item 2).

import { envList } from '../config';
import { query as defaultQuery } from '../db';
import type { QueryFn } from '../db';
import { IdentityResolver, isDid } from '../atproto/identity';
import type { FetchFn, Profile } from '../atproto/identity';
import { InvalidRecordError, parseVideoPost, VIDEO_POST_NSID } from '../atproto/videoPost';
import { JetstreamSubscription, parseCommit, RKEY_RE } from './jetstream';
import type { JetstreamEvent, WebSocketLike } from './jetstream';

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

// The ingest_cursor row; 'jetstream' predates the bridge's own subscription.
const CURSOR_KEY = 'jetstream';

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
  private readonly jetstream: JetstreamSubscription;
  private readonly seedDids: string[];
  private readonly profileMaxAgeMs: number;
  private readonly backfillConcurrency: number;

  /** Set by stop(). backfill() can also run without start(), so it starts false. */
  private stopped = false;
  private readonly known = new Set<string>();
  private readonly profileRefreshes = new Map<string, Promise<void>>();
  /** When each profile was last written, so fresh ones skip the database. */
  private readonly profileRefreshedAt = new Map<string, number>();
  private backfillRun: Promise<void> = Promise.resolve();

  constructor(opts: IngestOptions = {}) {
    this.db = opts.db ?? defaultQuery;
    this.fetch = opts.fetch ?? fetch;
    this.identity = opts.identity ?? new IdentityResolver({ fetch: this.fetch });
    this.jetstream = new JetstreamSubscription({
      tag: 'ingest', collections: [VIDEO_POST_NSID], cursorKey: CURSOR_KEY,
      onEvent: (e) => this.handleEvent(e), db: this.db, wsFactory: opts.wsFactory,
      url: opts.jetstreamUrl, cursorFlushMs: opts.cursorFlushMs,
    });
    this.seedDids = opts.seedDids ?? [];
    this.profileMaxAgeMs = opts.profileMaxAgeMs ?? 24 * 60 * 60 * 1000;
    this.backfillConcurrency = opts.backfillConcurrency ?? 4;
    for (const did of this.seedDids) {
      if (!isDid(did)) throw new Error(`seed DID ${did} is not a did:plc or did:web`);
    }
  }

  /** Load state, connect to Jetstream, and start backfilling known accounts. */
  async start(): Promise<void> {
    this.stopped = false;
    for (const did of this.seedDids) await this.addKnownAccount(did, 'seed');
    const rows = await this.db<{ did: string }>('SELECT did FROM known_accounts');
    for (const { did } of rows) this.known.add(did);

    await this.jetstream.start();
    this.backfillRun = this.backfillAll();
    console.log(`[ingest] started: ${this.known.size} known accounts`);
  }

  /** Disconnect, finish in-flight work and save the cursor. */
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([this.jetstream.stop(), this.backfillRun]);
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

  /** Handle one Jetstream event. Public so tests can drive it directly. */
  async handleEvent(event: JetstreamEvent): Promise<void> {
    if (event.kind === 'commit') {
      await this.handleCommit(event);
    } else if (event.kind === 'identity' && event.did && this.known.has(event.did)) {
      await this.refreshProfile(event.did, true);
    }
  }

  private async handleCommit(event: JetstreamEvent): Promise<void> {
    const c = parseCommit(event, VIDEO_POST_NSID);
    if (!c) return;
    const { did, rkey } = c;

    // A delete, or an edit that makes a record invalid, removes the row.
    if (c.operation === 'delete' || !(await this.indexRecord(did, rkey, c.cid, c.record))) {
      await this.db('DELETE FROM posts WHERE at_uri = $1', [c.uri]);
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
    seedDids: envList('INGEST_SEED_DIDS', ''),
    identity: new IdentityResolver({ plcDirectory: process.env.PLC_DIRECTORY_URL || undefined }),
  });
}
