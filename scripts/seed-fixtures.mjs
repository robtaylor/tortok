// scripts/seed-fixtures.mjs
//
// Publish the five test clips (Big Buck Bunny, CC-BY 3.0, see
// test-content/clips/CREDITS.md) as `app.tortok.video.post` records in the
// dev account's repo (Phase 3 Unit 2.5A). The AppView's ingest picks them up
// from Jetstream, or from backfill on its next boot.
//
// Torrents come from scripts/lib/test-clips.mjs, the same code
// upload-test-clips.mjs uses, so the infohashes match the clips already
// on R2. The poster and the .torrent file are uploaded to the PDS as the
// record's thumbnailBlob and torrentBlob (Decision 0020).
//
// Idempotent: a record whose infohash matches a clip is left alone when it's
// already the record this script would write, and rewritten in place (same
// rkey) when it isn't. Other records in the collection are listed; with
// --prune they're deleted.
//
// The account allows 10 logins a day, so the session is cached in
// ~/.cache/tortok/ (mode 0600) and resumed on later runs.
//
// Usage (from the repo root; BSKY_TEST_* come from .env):
//   npm run seed:fixtures [-- --dry-run] [-- --prune]
//
// Env:
//   BSKY_TEST_HANDLE, BSKY_TEST_APP_PASSWORD   the dev account
//   BSKY_SERVICE_URL     PDS to log in to (default https://bsky.social)
//   TRACKER_URLS, CONTENT_ORIGIN_URL, R2_PREFIX   see scripts/lib/test-clips.mjs

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AtpAgent } from '@atproto/api';
import { CLIPS, CLIP_META, buildClipTorrent, clipFiles, requireEnv } from './lib/test-clips.mjs';

const NSID = 'app.tortok.video.post';
const DRY_RUN = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');
const SERVICE_URL = process.env.BSKY_SERVICE_URL ?? 'https://bsky.social';

const log = (msg) => console.log(`${DRY_RUN ? '[dry-run] ' : ''}${msg}`);

// ─── Session, cached across runs ─────────────────────────────────────

async function login(handle) {
  const dir = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'tortok');
  const file = path.join(dir, `bsky-session-${handle}.json`);
  const agent = new AtpAgent({
    service: SERVICE_URL,
    persistSession: (evt, session) => {
      if (session) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
      } else if (evt === 'expired' || evt === 'create-failed') {
        fs.rmSync(file, { force: true });
      }
    },
  });
  if (fs.existsSync(file)) {
    try {
      await agent.resumeSession(JSON.parse(fs.readFileSync(file, 'utf8')));
      log(`resumed cached session for ${handle}`);
      return agent;
    } catch (err) {
      log(`cached session unusable (${err.message}); logging in`);
    }
  }
  await agent.login({ identifier: handle, password: requireEnv('BSKY_TEST_APP_PASSWORD') });
  log(`logged in as ${handle}`);
  return agent;
}

// ─── Clips ────────────────────────────────────────────────────────────

/** The record a clip should have, minus its blobs and createdAt. */
async function prepareClip(clip) {
  const { clipPath, posterPath, clipUrl } = clipFiles(clip);

  // The webseed must serve this exact file, or the record is unplayable.
  const head = await fetch(clipUrl, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  if (!head.ok || size !== fs.statSync(clipPath).size) {
    throw new Error(`${clipUrl}: HTTP ${head.status}, ${size} bytes; run upload-test-clips.mjs first`);
  }

  const { torrentBuf, infoHash, magnet } = await buildClipTorrent(clipPath, clipUrl);
  return {
    name: clip.name,
    torrentBuf,
    posterBuf: fs.readFileSync(posterPath),
    fields: {
      $type: NSID,
      magnetUri: magnet,
      infoHash,
      durationMs: CLIP_META.durationMs,
      aspectRatio: { width: CLIP_META.width, height: CLIP_META.height },
      caption: clip.title,
      hashtags: CLIP_META.tags.map((tag) => `#${tag}`),
    },
  };
}

/** True if an existing record already is what this script would write. */
function isUpToDate(value, clip) {
  const { thumbnailBlob, torrentBlob, createdAt, ...fields } = value;
  return isDeepStrictEqual(fields, clip.fields)
    && thumbnailBlob?.size === clip.posterBuf.length && thumbnailBlob?.mimeType === 'image/jpeg'
    && torrentBlob?.size === clip.torrentBuf.length && torrentBlob?.mimeType === 'application/x-bittorrent';
}

// ─── Repo ─────────────────────────────────────────────────────────────

async function listOwnRecords(agent, did) {
  const records = [];
  let cursor;
  do {
    const { data } = await agent.com.atproto.repo.listRecords({ repo: did, collection: NSID, limit: 100, cursor });
    records.push(...data.records);
    cursor = data.records.length ? data.cursor : undefined;
  } while (cursor);
  return records;
}

async function uploadBlob(agent, bytes, encoding) {
  const { data: { blob } } = await agent.uploadBlob(bytes, { encoding });
  // The Lexicon's accept list is exact; a PDS that rewrites the MIME type
  // would publish a record the AppView rejects.
  if (blob.mimeType !== encoding) throw new Error(`PDS stored ${encoding} blob as ${blob.mimeType}`);
  return blob;
}

const rkeyOf = (uri) => uri.split('/').pop();

async function main() {
  const handle = requireEnv('BSKY_TEST_HANDLE');
  const clips = [];
  for (const clip of CLIPS) clips.push(await prepareClip(clip));
  log(`prepared ${clips.length} torrents: ${clips.map((c) => c.fields.infoHash.slice(0, 8)).join(', ')}`);

  const agent = await login(handle);
  const did = agent.session.did;
  const existing = await listOwnRecords(agent, did);
  log(`${did} has ${existing.length} ${NSID} records`);

  const wanted = new Set(clips.map((c) => c.fields.infoHash));
  const byInfoHash = new Map();
  for (const r of existing) {
    if (wanted.has(r.value.infoHash) && !byInfoHash.has(r.value.infoHash)) {
      byInfoHash.set(r.value.infoHash, r);
    } else if (PRUNE) {
      log(`deleting ${r.uri}`);
      if (!DRY_RUN) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: NSID, rkey: rkeyOf(r.uri) });
    } else {
      log(`not a fixture, left alone (delete with --prune): ${r.uri}`);
    }
  }

  const baseTime = Date.now();
  for (const [i, clip] of clips.entries()) {
    const current = byInfoHash.get(clip.fields.infoHash);
    if (current && isUpToDate(current.value, clip)) {
      log(`${clip.name}: up to date (${current.uri})`);
      continue;
    }
    if (DRY_RUN) {
      log(`${clip.name}: would ${current ? `rewrite ${current.uri}` : 'create a record'}`);
      continue;
    }

    const record = {
      ...clip.fields,
      thumbnailBlob: await uploadBlob(agent, clip.posterBuf, 'image/jpeg'),
      torrentBlob: await uploadBlob(agent, clip.torrentBuf, 'application/x-bittorrent'),
      // Keep the clips in order in a newest-first feed: bbb-01 first.
      createdAt: current?.value.createdAt ?? new Date(baseTime - i * 1000).toISOString(),
    };
    const { data } = current
      ? await agent.com.atproto.repo.putRecord({ repo: did, collection: NSID, rkey: rkeyOf(current.uri), record, validate: false })
      : await agent.com.atproto.repo.createRecord({ repo: did, collection: NSID, record, validate: false });
    log(`${clip.name}: ${current ? 'rewrote' : 'created'} ${data.uri}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
