// scripts/atproto-smoke-test.mjs
//
// Phase 3 Unit 1 smoke test — round-trips a real `app.tortok.video.post`
// record against a real bsky.social PDS, using app-password auth.
//
// What it proves:
//   1. We can log in to bsky.social as a real account
//   2. We can upload a thumbnail blob to that user's PDS
//   3. The PDS accepts a record under the `app.tortok.video.post`
//      collection (i.e., it allows non-app.bsky.* lexicons from
//      third parties — the load-bearing assumption of the v1
//      no-custom-PDS architecture)
//   4. The record reads back identically
//
// Usage:
//   cp .env.example .env       # then fill in your handle + app password
//   npm run smoke:atproto
//
// Or override env inline:
//   BSKY_TEST_HANDLE=... BSKY_TEST_APP_PASSWORD=... npm run smoke:atproto
//
// Optional env:
//   BSKY_SERVICE_URL  — defaults to https://bsky.social
//   CLIP              — clip slug, defaults to "bbb-01"
//
// The script does NOT delete the record it creates. After a successful
// run you'll have an app.tortok.video.post record sitting in your test
// repo. To delete it, take the printed URI and call:
//   agent.com.atproto.repo.deleteRecord({ repo, collection, rkey })

import 'dotenv/config';
import { AtpAgent } from '@atproto/api';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const HANDLE = process.env.BSKY_TEST_HANDLE;
const APP_PASSWORD = process.env.BSKY_TEST_APP_PASSWORD;
const SERVICE_URL = process.env.BSKY_SERVICE_URL ?? 'https://bsky.social';
const CLIP = process.env.CLIP ?? 'bbb-01';

if (!HANDLE || !APP_PASSWORD) {
  console.error(
    'Missing BSKY_TEST_HANDLE or BSKY_TEST_APP_PASSWORD.\n' +
      'Create a .env at the repo root (cp .env.example .env) and fill in:\n' +
      '  BSKY_TEST_HANDLE=tortok-dev.bsky.social\n' +
      "  BSKY_TEST_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx",
  );
  process.exit(1);
}

const log = (msg) => console.log(`[smoke] ${msg}`);

// ---------- Step 0: load test inputs ----------

const posterPath = resolve(REPO_ROOT, `test-content/posters/${CLIP}.jpg`);
const magnetPath = resolve(REPO_ROOT, `test-content/${CLIP}.magnet.txt`);

const posterBytes = await readFile(posterPath);
const magnetUri = (await readFile(magnetPath, 'utf8')).trim();

const infoHashMatch = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
if (!infoHashMatch) {
  throw new Error(`Could not parse infoHash from magnet at ${magnetPath}`);
}
const infoHash = infoHashMatch[1].toLowerCase();

log(`clip=${CLIP}`);
log(`thumbnail=${posterPath} (${posterBytes.length} bytes)`);
log(`magnet=${magnetUri.slice(0, 80)}...`);
log(`infoHash=${infoHash}`);

// ---------- Step 1: login ----------

const agent = new AtpAgent({ service: SERVICE_URL });
log(`logging in as ${HANDLE} on ${SERVICE_URL}`);
await agent.login({ identifier: HANDLE, password: APP_PASSWORD });
const did = agent.session?.did;
if (!did) throw new Error('Login succeeded but no DID on session');
log(`logged in. did=${did}`);

// ---------- Step 2: upload blob ----------

log(`uploading ${posterBytes.length}-byte JPEG thumbnail...`);
const blobResult = await agent.uploadBlob(posterBytes, {
  encoding: 'image/jpeg',
});
const blob = blobResult.data.blob;
log(
  `blob uploaded. size=${blob.size}, ` +
    `mime=${blob.mimeType}, cid=${blob.ref?.toString?.() ?? '?'}`,
);

// ---------- Step 3: create record ----------

const record = {
  $type: 'app.tortok.video.post',
  magnetUri,
  infoHash,
  durationMs: 15000,
  aspectRatio: { width: 1080, height: 1920 },
  caption: `Smoke test ${new Date().toISOString()}`,
  thumbnailBlob: blob,
  hashtags: ['#tortok', '#smoketest'],
  hlsFallbackUrl: `https://webseed.tortok.example/video/${CLIP}.m3u8`,
  createdAt: new Date().toISOString(),
};

log('creating app.tortok.video.post record...');
const createResult = await agent.com.atproto.repo.createRecord({
  repo: did,
  collection: 'app.tortok.video.post',
  record,
});
const recordUri = createResult.data.uri;
const recordCid = createResult.data.cid;
log(`record created. uri=${recordUri}, cid=${recordCid}`);

// ---------- Step 4: read back ----------

const rkey = recordUri.split('/').pop();
log('reading record back...');
const readResult = await agent.com.atproto.repo.getRecord({
  repo: did,
  collection: 'app.tortok.video.post',
  rkey,
});
const readBytes = JSON.stringify(readResult.data.value).length;
log(`read OK. ${readBytes} bytes round-tripped.`);

// ---------- Done ----------

console.log('\n✓ Smoke test passed');
console.log(`  DID:        ${did}`);
console.log(`  Record URI: ${recordUri}`);
console.log(`  Record CID: ${recordCid}`);
console.log(`  Inspector:  https://atproto-browser.vercel.app/at/${did}/app.tortok.video.post/${rkey}`);
console.log(`\nThe record is NOT auto-deleted; clean up your test repo manually.`);
