// scripts/seed-prod-test-content.mjs
//
// Publish the test-content clips (Big Buck Bunny, CC-BY 3.0 — see
// test-content/clips/CREDITS.md) to an environment: upload each clip,
// poster and .torrent to R2, then insert a `videos` row per clip.
//
// Each torrent is single-file, announces only to tortok's own tracker,
// and carries a BEP-19 webseed pointing at the clip's R2 URL, so it is
// playable with no seeder running (see
// docs/architecture/decisions/spikes/webseed-only-origin.md).
//
// Idempotent: R2 puts overwrite, and existing rows for the same infohash
// are replaced (their hashtag usage counts are released first, and their
// likes/views go with them). Other videos are left alone.
//
// Stopgap: this writes the legacy `videos` table directly. Phase 3 moves
// publishing to atproto records, and this script should be replaced then.
//
// Usage (from the repo root; R2_* come from .env):
//   DATABASE_URL=postgres://... OWNER_USERNAME=testuser \
//     node scripts/seed-prod-test-content.mjs [--dry-run]
//
// Env:
//   DATABASE_URL     target Postgres (required unless --dry-run)
//   OWNER_USERNAME   user who owns the rows (default: testuser)
//   TRACKER_URLS        comma-separated (default wss://tortok-tracker.fly.dev)
//   CONTENT_ORIGIN_URL  bucket's public origin (default https://content.tortok.net)
//   (the same names and production values as backend/fly.toml)
//   R2_PREFIX        key prefix in the bucket (default: test-content)

import 'dotenv/config';
import fs from 'fs';
import { createRequire } from 'module';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CLIPS, CLIP_META, buildClipTorrent, clipFiles, PUBLIC_URL, requireEnv,
} from './lib/test-clips.mjs';

// pg lives in backend/node_modules.
const { Client } = createRequire(new URL('../backend/package.json', import.meta.url))('pg');

const DRY_RUN = process.argv.includes('--dry-run');
const OWNER_USERNAME = process.env.OWNER_USERNAME ?? 'testuser';
const R2_BUCKET = process.env.R2_BUCKET ?? 'tortok-content';
const META = {
  durationSeconds: CLIP_META.durationMs / 1000, width: CLIP_META.width, height: CLIP_META.height,
  hashtags: CLIP_META.tags,
};

const s3 = DRY_RUN ? null : new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT
    ?? `https://${requireEnv('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  },
});

const publicUrl = (key) => `${PUBLIC_URL}/${key}`;

async function put(key, body, contentType) {
  if (DRY_RUN) return;
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

async function main() {
  // Fail before any upload: every input file exists, and a DB target is set.
  const inputs = CLIPS.map((clip) => ({ ...clip, ...clipFiles(clip) }));
  const databaseUrl = DRY_RUN ? null : requireEnv('DATABASE_URL');

  const prepared = [];
  for (const clip of inputs) {
    const { torrentBuf, infoHash, magnet } = await buildClipTorrent(clip.clipPath, clip.clipUrl);
    await put(clip.keys.clip, fs.readFileSync(clip.clipPath), 'video/mp4');
    await put(clip.keys.poster, fs.readFileSync(clip.posterPath), 'image/jpeg');
    await put(clip.keys.torrent, torrentBuf, 'application/x-bittorrent');
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}uploaded ${clip.name}: ${magnet}`);

    prepared.push({
      name: clip.name,
      caption: `${clip.title} ${CLIP_META.tags.map((tag) => `#${tag}`).join(' ')}`,
      infoHash,
      magnet,
      torrentFileUrl: publicUrl(clip.keys.torrent),
      posterUrl: publicUrl(clip.keys.poster),
    });
  }

  if (DRY_RUN) return;

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: [owner] } = await db.query('SELECT id FROM users WHERE username = $1', [OWNER_USERNAME]);
    if (!owner) throw new Error(`owner ${OWNER_USERNAME} not found`);
    const userId = owner.id;

    await db.query('BEGIN');
    // Stagger created_at so the feed (newest first) shows bbb-01 first in a
    // stable order; rows inserted in one transaction would otherwise tie.
    for (const [i, p] of prepared.entries()) {
      // Replace any earlier row for this infohash, releasing its hashtag
      // usage counts first so re-runs don't inflate them.
      const prior = `magnet:?xt=urn:btih:${p.infoHash}%`;
      await db.query(
        `UPDATE hashtags h SET usage_count = GREATEST(h.usage_count - 1, 0)
           FROM video_hashtags vh JOIN videos v ON v.id = vh.video_id
          WHERE vh.hashtag_id = h.id AND v.magnet_link LIKE $1`, [prior]);
      await db.query('DELETE FROM videos WHERE magnet_link LIKE $1', [prior]);
      const { rows } = await db.query(
        `INSERT INTO videos (user_id, caption, magnet_link, torrent_file_url, poster_url,
                             duration_seconds, width, height, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() - make_interval(secs => $9)) RETURNING id`,
        [userId, p.caption, p.magnet, p.torrentFileUrl, p.posterUrl,
          META.durationSeconds, META.width, META.height, i]);
      for (const tag of META.hashtags) {
        const h = await db.query(
          `INSERT INTO hashtags (name, usage_count) VALUES ($1, 1)
           ON CONFLICT (name) DO UPDATE SET usage_count = hashtags.usage_count + 1
           RETURNING id`, [tag]);
        await db.query('INSERT INTO video_hashtags (video_id, hashtag_id) VALUES ($1, $2)',
          [rows[0].id, h.rows[0].id]);
      }
      console.log(`row ${p.name} → ${rows[0].id}`);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
