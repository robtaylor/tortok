#!/usr/bin/env node
// scripts/bsky-nsfw-cleanup.mjs
//
// One-shot cleanup pass over `bridged_posts`: queries Bluesky's
// public AppView for the labels on every currently `pending` or
// `mirrored` row, demotes any whose labels intersect the NSFW
// set, and drops the R2 bytes for already-mirrored ones.
//
// Run from repo root:
//   node scripts/bsky-nsfw-cleanup.mjs
//
// Env (via top-level .env):
//   DATABASE_URL                    — postgres
//   CLOUDFLARE_ACCOUNT_ID +
//   R2_ACCESS_KEY_ID +
//   R2_SECRET_ACCESS_KEY +
//   R2_BUCKET +
//   R2_ENDPOINT                    — for deleting R2 objects
//   BSKY_NSFW_LABELS               — optional override of the
//                                    default label set
//
// The engagement poller does this work too on a 30-min cadence;
// this script is for compressing that into ~minutes when you've
// just landed the filter and want existing rows cleaned up
// immediately.

import 'dotenv/config';
import pg from 'pg';
import {
  S3Client,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const DEFAULT_NSFW = ['porn', 'sexual', 'nudity', 'graphic-media', 'gore'];
const NSFW = new Set(
  (process.env.BSKY_NSFW_LABELS ?? DEFAULT_NSFW.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const APPVIEW = 'https://public.api.bsky.app';
const BATCH = 25;
const SLEEP_MS = 250; // be polite to bsky's AppView

const dbUrl = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/tortok';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const r2Bucket = process.env.R2_BUCKET ?? 'tortok-content';
const r2Endpoint =
  process.env.R2_ENDPOINT ??
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
const r2Key = process.env.R2_ACCESS_KEY_ID;
const r2Secret = process.env.R2_SECRET_ACCESS_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[nsfw-cleanup] ${msg}`);

const pool = new pg.Pool({ connectionString: dbUrl });

let s3 = null;
if (r2Key && r2Secret && r2Endpoint) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: { accessKeyId: r2Key, secretAccessKey: r2Secret },
  });
} else {
  log('R2 credentials missing — will demote rows but not delete bytes');
}

async function deleteR2(key) {
  if (!s3) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }));
  } catch (err) {
    log(`R2 delete failed for ${key}: ${err.message ?? err}`);
  }
}

async function getPostsBatch(uris) {
  const params = new URLSearchParams();
  for (const uri of uris) params.append('uris', uri);
  const url = `${APPVIEW}/xrpc/app.bsky.feed.getPosts?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getPosts HTTP ${res.status}`);
  const json = await res.json();
  return json.posts ?? [];
}

async function main() {
  log(`NSFW set: ${[...NSFW].join(', ')}`);
  log('querying postgres for active rows…');

  const { rows } = await pool.query(
    `SELECT id, bsky_at_uri, bsky_did, video_cid, mirror_state, r2_path
       FROM bridged_posts
      WHERE mirror_state IN ('pending', 'mirrored')`
  );
  log(`${rows.length} active rows to inspect`);

  let demoted = 0;
  let inspected = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const uris = slice.map((r) => r.bsky_at_uri);

    let posts;
    try {
      posts = await getPostsBatch(uris);
    } catch (err) {
      log(`batch ${i}/${rows.length} failed: ${err.message ?? err} (skipping)`);
      await sleep(SLEEP_MS * 4);
      continue;
    }

    const postByUri = new Map();
    for (const p of posts) if (p.uri) postByUri.set(p.uri, p);

    for (const row of slice) {
      inspected++;
      const post = postByUri.get(row.bsky_at_uri);
      if (!post) continue; // upstream-deleted; let the regular poller handle
      const labels = post.labels ?? [];
      const hit = labels.some((l) => l?.val && NSFW.has(l.val));
      if (!hit) continue;

      // Demote.
      await pool.query(
        `UPDATE bridged_posts
            SET mirror_state = 'declined',
                magnet_link = NULL,
                torrent_file_url = NULL,
                r2_path = NULL
          WHERE id = $1`,
        [row.id]
      );

      // Drop R2 bytes for previously-mirrored rows.
      if (row.mirror_state === 'mirrored' && row.r2_path) {
        const r2Path = row.r2_path;
        const isFile = r2Path.endsWith('.mp4');
        if (isFile) {
          await deleteR2(r2Path);
          await deleteR2(`${r2Path}.torrent`);
          await deleteR2(r2Path.replace(/\.mp4$/, '.jpg'));
        } else {
          // Old-style multi-file directory (pre-MP4 pivot). Just
          // log; the decay job's prefix-style branch handles these.
          log(`(legacy directory r2_path; deferring to decay): ${r2Path}`);
        }
      }

      demoted++;
    }

    if ((i / BATCH) % 4 === 0) {
      log(`  inspected ${inspected}/${rows.length}, demoted so far: ${demoted}`);
    }
    await sleep(SLEEP_MS);
  }

  log('');
  log(`done. inspected=${inspected}, demoted=${demoted}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[nsfw-cleanup] fatal:', err);
  process.exitCode = 1;
  pool.end();
});
