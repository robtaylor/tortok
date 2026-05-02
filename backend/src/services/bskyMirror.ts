// Phase 3 Unit 2.5 — HLS-to-magnet mirror pipeline (slice 3).
//
// Consumes `bridged_posts` rows in `mirror_state = 'mirrored' AND
// r2_path IS NULL` (newly-promoted by the engagement poller, no
// bytes copied yet), fetches the source HLS playlist + segments
// from Bluesky's video CDN, re-uploads them to R2 under
// `bridged/{did}/{cid}/`, generates a `.torrent` whose webseed
// points at the R2-fronted public URL, and writes the result back
// onto the row. After this, client playback uses ADR-008's
// pipeline (R2 = origin, our trackers = discovery, webseed via
// the R2 public host) — one playback path for both native and
// bridged content.
//
// Pipeline (per ADR-010-A Decision 4''):
//   firehose → pending → poller → [mirror: this file] → r2_path set
//                                                          ↓
//                                                     [decay: this file]
//                                                          ↓
//                                                       expired
//
// A separate decay loop walks `mirrored AND r2_path IS NOT NULL`
// rows whose `last_played_at` (or `mirrored_at` for never-played)
// is older than `BSKY_DECAY_DAYS`, deletes the R2 prefix, and
// transitions the row to `expired`. Re-mirror on demand from
// `expired` is slice 4's responsibility (the feed endpoint will
// touch `last_played_at` and flip `expired → mirrored AND r2_path
// IS NULL` so this loop picks the row back up).
//
// Singleton + hot-reload guard mirrors `bskyFirehose.ts` and
// `bskyEngagementPoller.ts`. Two intervals (mirror + decay) are
// scheduled by `start()` and cancelled by `stop()`.
//
// Dependencies on ESM-only packages (`webtorrent`'s sibling
// `create-torrent` + `parse-torrent`) are loaded via dynamic
// import to keep the rest of the backend on CJS — same pattern
// `seeder.ts` uses for `webtorrent`.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { promises as fsp } from 'fs';
import { query } from '../db';

// ─── Types ───────────────────────────────────────────────────────

interface MirrorRow {
  id: string;
  bsky_at_uri: string;
  bsky_did: string;
  video_cid: string;
  video_bsky_playlist_url: string;
  mirrored_at: Date | null;
  last_played_at: Date | null;
  r2_path: string | null;
}

// Minimal S3-client surface we depend on. Matches @aws-sdk/client-s3's
// `S3Client.send(...)` shape. Tests inject a mock that records calls.
interface S3Like {
  send(cmd: any): Promise<any>;
}

// Torrent generator — given a directory + a torrent name + tracker
// config, return the .torrent file bytes. Default uses
// `create-torrent` (dynamically imported). Test injects a stub.
type TorrentFromDirFn = (
  dir: string,
  name: string,
  opts: { announce: string[]; urlList: string[] }
) => Promise<Uint8Array>;

// Torrent → magnet helper. Default uses `parse-torrent`. Async to
// accommodate both sync test stubs (returning a string directly)
// and the production path (which awaits a dynamic import of the
// ESM-only `parse-torrent` package).
type MagnetFromTorrentFn = (
  buf: Uint8Array,
  name: string
) => string | Promise<string>;

interface S3Commands {
  PutObjectCommand: new (input: any) => any;
  ListObjectsV2Command: new (input: any) => any;
  DeleteObjectsCommand?: new (input: any) => any;
  DeleteObjectCommand: new (input: any) => any;
}

interface BskyMirrorOpts {
  db?: typeof query;
  fetchFn?: typeof fetch;
  s3Client?: S3Like;
  s3Commands?: S3Commands;
  bucket?: string;
  webseedBase?: string;
  torrentFromDir?: TorrentFromDirFn;
  magnetFromTorrent?: MagnetFromTorrentFn;
  nowFn?: () => Date;
  trackers?: string[];
}

// ─── Constants ───────────────────────────────────────────────────

// Tracker list duplicated from `seeder.ts` (ADR-008 L3). Refactor
// to a shared constant if a third caller appears.
const DEFAULT_TRACKERS = [
  'wss://tortok-tracker.fly.dev',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
];

const DEFAULT_MIRROR_INTERVAL_SEC = 60;
const DEFAULT_MIRROR_BATCH = 1;
const DEFAULT_DECAY_DAYS = 30;
const DEFAULT_DECAY_INTERVAL_SEC = 3600;

// ─── Hot-reload-safe singleton state ─────────────────────────────

type MirrorGlobals = {
  __bskyMirror?: BskyMirrorService;
};
const g = globalThis as MirrorGlobals;

// ─── SQL ─────────────────────────────────────────────────────────

// Mirror tick batch SELECT — oldest mirrored_at first so freshly
// promoted rows are processed in the order the poller produced them.
// `mirrored_at` was set by the engagement poller at promotion time
// (slice 2 — promotion-at semantic). The mirror tick will overwrite
// it with NOW() at bytes-landed-time below; see UPDATE_MIRROR_SQL.
const SELECT_MIRROR_BATCH_SQL = `
  SELECT id,
         bsky_at_uri,
         bsky_did,
         video_cid,
         video_bsky_playlist_url,
         mirrored_at,
         last_played_at,
         r2_path
    FROM bridged_posts
   WHERE mirror_state = 'mirrored'
     AND r2_path IS NULL
   ORDER BY mirrored_at ASC NULLS FIRST, indexed_at ASC
   LIMIT $1
`;

// Mirror tick UPDATE — sets r2_path / magnet_link / torrent_file_url
// and refreshes `mirrored_at` to NOW() (semantic shift: this is
// "bytes-landed-at", not "promoted-at"; the poller's earlier value
// is replaced. See ADR-010-A; the field is single-purpose at the
// schema level — it just tracks the most recent state-changing
// event on the mirror state machine).
const UPDATE_MIRROR_SQL = `
  UPDATE bridged_posts
     SET r2_path = $1,
         magnet_link = $2,
         torrent_file_url = $3,
         mirrored_at = NOW()
   WHERE id = $4
`;

// Decay scan — `mirrored_at` is fall-back when `last_played_at` is
// null (never-played mirrors decay too).
const SELECT_DECAY_BATCH_SQL = `
  SELECT id,
         bsky_at_uri,
         bsky_did,
         video_cid,
         video_bsky_playlist_url,
         mirrored_at,
         last_played_at,
         r2_path
    FROM bridged_posts
   WHERE mirror_state = 'mirrored'
     AND r2_path IS NOT NULL
     AND (
       (last_played_at IS NOT NULL AND last_played_at < $1)
       OR
       (last_played_at IS NULL AND mirrored_at < $1)
     )
`;

const UPDATE_EXPIRED_SQL = `
  UPDATE bridged_posts
     SET mirror_state = 'expired',
         r2_path = NULL,
         magnet_link = NULL,
         torrent_file_url = NULL
   WHERE id = $1
`;

// ─── Service ─────────────────────────────────────────────────────

export class BskyMirrorService {
  private mirrorTimer: NodeJS.Timeout | null = null;
  private decayTimer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private mirrorTickInFlight = false;
  private decayTickInFlight = false;

  // Tunables (read on construct).
  private readonly mirrorIntervalSec: number;
  private readonly mirrorBatch: number;
  private readonly decayDays: number;
  private readonly decayIntervalSec: number;

  // Injectables — defaults wire to real prod deps; tests inject mocks.
  private readonly db: typeof query;
  private readonly fetchFn: typeof fetch;
  // Held as nullable + lazy; only constructed on first use so a
  // module-level `new BskyMirrorService()` (the singleton at the
  // bottom of this file) doesn't eagerly fire a dynamic import that
  // jest's CJS test runner can't satisfy without --experimental-vm-modules.
  private s3ClientPromise: Promise<S3Like> | null;
  private s3CommandsPromise: Promise<S3Commands> | null;
  private readonly bucket: string;
  private readonly webseedBase: string;
  private readonly torrentFromDir: TorrentFromDirFn;
  private readonly magnetFromTorrent: MagnetFromTorrentFn;
  private readonly nowFn: () => Date;
  private readonly trackers: string[];

  constructor(opts: BskyMirrorOpts = {}) {
    this.db = opts.db ?? query;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.bucket = opts.bucket ?? process.env.R2_BUCKET ?? 'tortok-content';
    this.webseedBase = opts.webseedBase ?? deriveWebseedBase();
    this.nowFn = opts.nowFn ?? (() => new Date());
    this.trackers = opts.trackers ?? DEFAULT_TRACKERS;

    // S3 client + commands: if injected, use directly; otherwise
    // defer construction until first call (see getters below).
    this.s3ClientPromise = opts.s3Client ? Promise.resolve(opts.s3Client) : null;
    this.s3CommandsPromise = opts.s3Commands
      ? Promise.resolve(opts.s3Commands)
      : null;

    // Torrent generator: if injected, use directly; otherwise lazy-load
    // create-torrent / parse-torrent on first invocation. We pre-bind
    // a wrapper that does the dynamic import once and caches it.
    this.torrentFromDir = opts.torrentFromDir ?? defaultTorrentFromDir;
    this.magnetFromTorrent = opts.magnetFromTorrent ?? defaultMagnetFromTorrent;

    this.mirrorIntervalSec = readPositiveInt(
      'BSKY_MIRROR_INTERVAL_SEC',
      DEFAULT_MIRROR_INTERVAL_SEC
    );
    this.mirrorBatch = readPositiveInt('BSKY_MIRROR_BATCH', DEFAULT_MIRROR_BATCH);
    this.decayDays = readPositiveInt('BSKY_DECAY_DAYS', DEFAULT_DECAY_DAYS);
    this.decayIntervalSec = readPositiveInt(
      'BSKY_DECAY_INTERVAL_SEC',
      DEFAULT_DECAY_INTERVAL_SEC
    );
  }

  // Lazy accessors — defer dynamic-import side effects until first
  // actual mirror operation. Module-level instantiation in jest
  // would otherwise trip
  // `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`.
  private getS3Client(): Promise<S3Like> {
    if (!this.s3ClientPromise) {
      this.s3ClientPromise = constructR2Client();
    }
    return this.s3ClientPromise;
  }

  private getS3Commands(): Promise<S3Commands> {
    if (!this.s3CommandsPromise) {
      this.s3CommandsPromise = loadS3Commands();
    }
    return this.s3CommandsPromise;
  }

  start(): void {
    this.stopRequested = false;
    console.log(
      `[BskyMirror] started (mirror_interval=${this.mirrorIntervalSec}s, ` +
        `mirror_batch=${this.mirrorBatch}, decay_days=${this.decayDays}, ` +
        `decay_interval=${this.decayIntervalSec}s, bucket=${this.bucket}, ` +
        `webseed_base=${this.webseedBase})`
    );
    // Fire one tick immediately on boot for fast feedback in dev.
    void this.mirrorTick();
    void this.decayTick();
  }

  stop(): void {
    this.stopRequested = true;
    if (this.mirrorTimer) {
      clearTimeout(this.mirrorTimer);
      this.mirrorTimer = null;
    }
    if (this.decayTimer) {
      clearTimeout(this.decayTimer);
      this.decayTimer = null;
    }
    console.log('[BskyMirror] stopped');
  }

  // ─── Mirror loop ───────────────────────────────────────────────

  private async mirrorTick(): Promise<void> {
    if (this.mirrorTickInFlight) return;
    this.mirrorTickInFlight = true;
    try {
      await this.runMirrorOnce();
    } catch (err) {
      console.error('[BskyMirror] unexpected mirror tick error:', err);
    } finally {
      this.mirrorTickInFlight = false;
      this.scheduleMirrorNext();
    }
  }

  private scheduleMirrorNext(): void {
    if (this.stopRequested) return;
    if (this.mirrorTimer) return;
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = null;
      void this.mirrorTick();
    }, this.mirrorIntervalSec * 1000);
  }

  // Single bounded batch for the mirror loop. Public for testing.
  async runMirrorOnce(): Promise<void> {
    if (this.stopRequested) return;

    let rows: MirrorRow[];
    try {
      rows = await this.db<MirrorRow>(SELECT_MIRROR_BATCH_SQL, [this.mirrorBatch]);
    } catch (err) {
      console.error('[BskyMirror] mirror SELECT failed:', err);
      return;
    }

    if (rows.length === 0) {
      return;
    }

    for (const row of rows) {
      if (this.stopRequested) return;
      try {
        await this.mirrorOne(row);
      } catch (err) {
        // Per-row failures are isolated — don't tank the whole tick.
        // The row stays unchanged (r2_path still NULL) and will be
        // retried next tick. Note: a partial set of segments may
        // already be uploaded to R2; v1 accepts the leak — duplicate
        // PUTs are idempotent so a retry overwrites cleanly.
        console.error(
          `[BskyMirror] mirror failed for ${row.bsky_at_uri}:`,
          err
        );
      }
    }
  }

  private async mirrorOne(row: MirrorRow): Promise<void> {
    const r2Prefix = `bridged/${row.bsky_did}/${row.video_cid}/`;
    const playlistUrl = row.video_bsky_playlist_url;

    // 1. Fetch + parse the source playlist. Resolve variant playlists
    //    transparently (recursively pick the highest-bandwidth track).
    const { playlistText, segmentUrls } = await fetchHlsTree(
      this.fetchFn,
      playlistUrl
    );

    // 2. Stage to a temp dir on disk so create-torrent can hash a
    //    contiguous file set. (create-torrent supports streams in
    //    theory, but the directory-based path is much simpler and
    //    matches what `seeder.ts` does for native uploads.)
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bsky-mirror-'));
    try {
      // Write the playlist file with the same basename as the source
      // (`playlist.m3u8`) so its relative segment paths resolve when
      // served from R2. Don't rewrite the playlist text.
      const playlistBasename = basenameFromUrl(playlistUrl);
      await fsp.writeFile(path.join(tmpDir, playlistBasename), playlistText);

      // 3. Stream each segment to disk + R2 in parallel.
      const segDownloads = segmentUrls.map(async (segUrl) => {
        const res = await this.fetchFn(segUrl);
        if (!res.ok) {
          throw new Error(`segment ${segUrl} HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const segName = basenameFromUrl(segUrl);
        await fsp.writeFile(path.join(tmpDir, segName), buf);
        return { segName, buf };
      });
      const segs = await Promise.all(segDownloads);

      // 4. Upload playlist + every segment to R2.
      const s3 = await this.getS3Client();
      // Lazy-import the S3 commands so test doubles don't need them.
      const cmds = await this.getS3Commands();

      const playlistBytes = Buffer.from(playlistText, 'utf-8');
      await s3.send(
        new cmds.PutObjectCommand({
          Bucket: this.bucket,
          Key: `${r2Prefix}${playlistBasename}`,
          Body: playlistBytes,
          ContentType: 'application/vnd.apple.mpegurl',
        })
      );
      for (const { segName, buf } of segs) {
        await s3.send(
          new cmds.PutObjectCommand({
            Bucket: this.bucket,
            Key: `${r2Prefix}${segName}`,
            Body: buf,
            ContentType: contentTypeForSegment(segName),
          })
        );
      }

      // 5. Generate the .torrent. Webseed = the R2 public-URL prefix
      //    so WebTorrent peers without seeders fall back to HTTP.
      const torrentName = row.video_cid; // unique-per-video; collision-safe.
      const webseedUrl = `${this.webseedBase.replace(/\/$/, '')}/${r2Prefix}`;
      const torrentBytes = await this.torrentFromDir(tmpDir, torrentName, {
        announce: this.trackers,
        urlList: [webseedUrl],
      });

      // 6. Upload the .torrent to R2 alongside the segments.
      const torrentKey = `${r2Prefix}${torrentName}.torrent`;
      await s3.send(
        new cmds.PutObjectCommand({
          Bucket: this.bucket,
          Key: torrentKey,
          Body: Buffer.from(torrentBytes),
          ContentType: 'application/x-bittorrent',
        })
      );

      const magnet = await Promise.resolve(
        this.magnetFromTorrent(torrentBytes, torrentName)
      );
      const torrentFileUrl = `${this.webseedBase.replace(/\/$/, '')}/${torrentKey}`;

      // 7. Write the row.
      await this.db(UPDATE_MIRROR_SQL, [r2Prefix, magnet, torrentFileUrl, row.id]);

      console.log(
        `[BskyMirror] mirrored ${row.bsky_at_uri} → ${r2Prefix} ` +
          `(${segs.length} segments, ${segs.reduce(
            (n, s) => n + s.buf.length,
            0
          )} bytes)`
      );
    } finally {
      // Always clean up the temp staging dir.
      try {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }

  // ─── Decay loop ────────────────────────────────────────────────

  private async decayTick(): Promise<void> {
    if (this.decayTickInFlight) return;
    this.decayTickInFlight = true;
    try {
      await this.runDecayOnce();
    } catch (err) {
      console.error('[BskyMirror] unexpected decay tick error:', err);
    } finally {
      this.decayTickInFlight = false;
      this.scheduleDecayNext();
    }
  }

  private scheduleDecayNext(): void {
    if (this.stopRequested) return;
    if (this.decayTimer) return;
    this.decayTimer = setTimeout(() => {
      this.decayTimer = null;
      void this.decayTick();
    }, this.decayIntervalSec * 1000);
  }

  // Single decay scan. Public for testing.
  async runDecayOnce(): Promise<void> {
    if (this.stopRequested) return;

    const cutoff = new Date(
      this.nowFn().getTime() - this.decayDays * 24 * 60 * 60 * 1000
    );
    let rows: MirrorRow[];
    try {
      rows = await this.db<MirrorRow>(SELECT_DECAY_BATCH_SQL, [cutoff]);
    } catch (err) {
      console.error('[BskyMirror] decay SELECT failed:', err);
      return;
    }
    if (rows.length === 0) {
      return;
    }

    let decayed = 0;
    for (const row of rows) {
      if (this.stopRequested) return;
      if (!row.r2_path) continue; // belt-and-braces; SQL filters this
      try {
        await this.deleteR2Prefix(row.r2_path);
        await this.db(UPDATE_EXPIRED_SQL, [row.id]);
        decayed += 1;
      } catch (err) {
        // Don't half-decay. If R2 delete fails, leave row as
        // mirrored so the next tick retries.
        console.error(
          `[BskyMirror] decay failed for ${row.bsky_at_uri}:`,
          err
        );
      }
    }
    console.log(`[BskyMirror] decay tick: scanned=${rows.length}, decayed=${decayed}`);
  }

  private async deleteR2Prefix(prefix: string): Promise<void> {
    const s3 = await this.getS3Client();
    const cmds = await this.getS3Commands();
    // List all objects under the prefix; then bulk-delete via
    // DeleteObjectsCommand. R2 caps DeleteObjects at 1000 keys per
    // request; v1 typical mirror is single-digit segment count, so
    // one round-trip is plenty.
    const list = await s3.send(
      new cmds.ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );
    const keys = (list?.Contents ?? [])
      .map((o: any) => o?.Key)
      .filter((k: any): k is string => typeof k === 'string' && k.length > 0);
    if (keys.length === 0) return;

    if (cmds.DeleteObjectsCommand) {
      await s3.send(
        new cmds.DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((k: string) => ({ Key: k })) },
        })
      );
    } else {
      // Fallback: per-key DeleteObjectCommand if bulk variant is unavailable.
      for (const k of keys) {
        await s3.send(
          new cmds.DeleteObjectCommand({
            Bucket: this.bucket,
            Key: k,
          })
        );
      }
    }
  }
}

// ─── HLS playlist parsing ────────────────────────────────────────
//
// Minimal RFC 8216 reader. Two flavors of playlist matter:
//   - Master playlist (variant): contains `#EXT-X-STREAM-INF:...`
//     followed by sub-playlist URI lines. Pick highest BANDWIDTH.
//   - Media playlist: alternating `#EXTINF:...` + segment URI lines.
//
// We don't bother parsing every directive; we just collect the
// non-comment URI lines and classify by whether STREAM-INF is
// present. For variant playlists we recurse into the chosen
// sub-playlist. For media playlists we return the segment URLs
// resolved against the playlist's base.

interface FetchedPlaylist {
  playlistText: string;
  segmentUrls: string[];
}

async function fetchHlsTree(
  fetchFn: typeof fetch,
  playlistUrl: string
): Promise<FetchedPlaylist> {
  const res = await fetchFn(playlistUrl);
  if (!res.ok) {
    throw new Error(`playlist ${playlistUrl} HTTP ${res.status}`);
  }
  const text = await res.text();
  const lines = text.split(/\r?\n/);

  // Detect variant playlist.
  const variantStreams: { bandwidth: number; uri: string }[] = [];
  let pendingStreamInf: { bandwidth: number } | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const m = /BANDWIDTH=(\d+)/.exec(line);
      pendingStreamInf = { bandwidth: m ? Number(m[1]) : 0 };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pendingStreamInf) {
      variantStreams.push({ bandwidth: pendingStreamInf.bandwidth, uri: line });
      pendingStreamInf = null;
    }
  }

  if (variantStreams.length > 0) {
    // Master playlist — pick highest BANDWIDTH and recurse.
    variantStreams.sort((a, b) => b.bandwidth - a.bandwidth);
    const winner = variantStreams[0]!;
    const subUrl = resolveUrl(playlistUrl, winner.uri);
    return fetchHlsTree(fetchFn, subUrl);
  }

  // Media playlist — collect segment URIs.
  const segmentUrls: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    segmentUrls.push(resolveUrl(playlistUrl, line));
  }

  return { playlistText: text, segmentUrls };
}

function resolveUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function basenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'segment.ts';
    return last;
  } catch {
    return url.split('/').pop() ?? 'segment.ts';
  }
}

function contentTypeForSegment(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (name.endsWith('.ts')) return 'video/mp2t';
  if (name.endsWith('.m4s')) return 'video/iso.segment';
  if (name.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

// ─── R2 / @aws-sdk lazy loaders ──────────────────────────────────
//
// `@aws-sdk/client-s3` is loaded lazily. The seeder pattern uses
// `new Function('return import(...)')` to avoid TS down-compiling
// the dynamic import to require(). We mirror that.

const dynamicImport = (specifier: string): Promise<any> =>
  new Function('s', 'return import(s)')(specifier);

let s3CommandsCache: any | null = null;
async function loadS3Commands(): Promise<any> {
  if (s3CommandsCache) return s3CommandsCache;
  const mod = await dynamicImport('@aws-sdk/client-s3');
  s3CommandsCache = {
    PutObjectCommand: mod.PutObjectCommand,
    ListObjectsV2Command: mod.ListObjectsV2Command,
    DeleteObjectsCommand: mod.DeleteObjectsCommand,
    DeleteObjectCommand: mod.DeleteObjectCommand,
  };
  return s3CommandsCache;
}

async function constructR2Client(): Promise<S3Like> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint =
    process.env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    // No creds → the S3 calls will fail at first `send()`. That's
    // acceptable: log clearly so the dev sees what's missing and
    // returns a stub that throws on send. This way the service can
    // still boot for environments that don't care about the bridge
    // (e.g. unit tests for unrelated code).
    console.warn(
      '[BskyMirror] R2 credentials not set; mirror pipeline will fail on first PUT. ' +
        'Set CLOUDFLARE_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY.'
    );
    return {
      send: async () => {
        throw new Error('R2 client not configured');
      },
    };
  }

  const mod = await dynamicImport('@aws-sdk/client-s3');
  return new mod.S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function deriveWebseedBase(): string {
  // The webseed prefix is a public-facing R2 (or CF-fronted) URL.
  // Reuse `CONTENT_ORIGIN_URL` if set — that's the same contract
  // the existing seeder uses for native uploads. Fall back to the
  // R2 dev bucket URL the seeder hardcodes for prod.
  return (
    process.env.BSKY_MIRROR_WEBSEED_BASE ??
    process.env.CONTENT_ORIGIN_URL ??
    'https://pub-96c2a0ac73ac40359616969672d5f67f.r2.dev'
  );
}

// ─── Default torrent generator ───────────────────────────────────
//
// `create-torrent` is ESM-only. Cache the dynamically imported
// module across calls so we only pay the import cost once.

let createTorrentCache: any | null = null;
async function loadCreateTorrent(): Promise<any> {
  if (createTorrentCache) return createTorrentCache;
  const mod = await dynamicImport('create-torrent');
  createTorrentCache = mod.default ?? mod;
  return createTorrentCache;
}

let parseTorrentCache: any | null = null;
async function loadParseTorrent(): Promise<any> {
  if (parseTorrentCache) return parseTorrentCache;
  const mod = await dynamicImport('parse-torrent');
  parseTorrentCache = mod.default ?? mod;
  return parseTorrentCache;
}

const defaultTorrentFromDir: TorrentFromDirFn = async (dir, name, opts) => {
  const createTorrent = await loadCreateTorrent();
  return new Promise<Uint8Array>((resolve, reject) => {
    // create-torrent's signature: createTorrent(input, opts, cb)
    // where input can be a path. Returns a Buffer of the .torrent.
    createTorrent(
      dir,
      {
        name,
        announce: opts.announce,
        urlList: opts.urlList,
      },
      (err: Error | null, torrent: Buffer) => {
        if (err) reject(err);
        else resolve(new Uint8Array(torrent));
      }
    );
  });
};

const defaultMagnetFromTorrent: MagnetFromTorrentFn = async (buf, _name) => {
  const parseTorrent = await loadParseTorrent();
  // parse-torrent's API: pass a Buffer of the .torrent file. Older
  // versions return a plain object; newer versions return a Promise.
  // Normalize via Promise.resolve.
  const parsed = await Promise.resolve(parseTorrent(Buffer.from(buf)));
  if (parsed?.magnetURI) return parsed.magnetURI as string;
  // Build a magnet manually from the infoHash if magnetURI isn't on
  // the object (older parse-torrent versions).
  const ih = parsed?.infoHash;
  if (typeof ih !== 'string') {
    throw new Error('parse-torrent did not return an infoHash');
  }
  return `magnet:?xt=urn:btih:${ih}`;
};

// ─── Helpers ────────────────────────────────────────────────────

function readPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

// ─── Hot-reload-safe singleton export ───────────────────────────

if (g.__bskyMirror) {
  try {
    g.__bskyMirror.stop();
  } catch {
    // ignore
  }
}

// Pull in `fs` purely so the import isn't tree-shaken from the
// bundle; the file uses fs.promises (`fsp`) but ts-jest can choke
// on the bare import otherwise. Harmless reference.
void fs;

const instance = new BskyMirrorService();
g.__bskyMirror = instance;

export const bskyMirror: BskyMirrorService = instance;
