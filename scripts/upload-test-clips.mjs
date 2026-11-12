// scripts/upload-test-clips.mjs
//
// Upload the five test clips (Big Buck Bunny, CC-BY 3.0, see
// test-content/clips/CREDITS.md) to R2, where their torrents' BEP-19
// webseed points. Run it once per bucket or prefix, before
// seed-fixtures.mjs publishes records whose magnets name these URLs.
//
// Only the clips go to R2: posters and .torrent files travel as PDS blobs
// in the records (Decision 0020) and are served by the AppView's blob route.
//
// Idempotent: R2 puts overwrite with the same bytes.
//
// Usage (from the repo root; R2_* come from .env):
//   npm run upload:test-clips [-- --dry-run]
//
// Env:
//   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   R2_ENDPOINT   overrides the account's R2 endpoint
//   R2_BUCKET     default tortok-content
//   R2_PREFIX, CONTENT_ORIGIN_URL   see scripts/lib/test-clips.mjs

import 'dotenv/config';
import fs from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CLIPS, clipFiles, requireEnv } from './lib/test-clips.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const R2_BUCKET = process.env.R2_BUCKET ?? 'tortok-content';

async function main() {
  // Fail before any upload if an input file is missing.
  const inputs = CLIPS.map((clip) => ({ name: clip.name, ...clipFiles(clip) }));
  const s3 = DRY_RUN ? null : new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT
      ?? `https://${requireEnv('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  for (const clip of inputs) {
    if (!DRY_RUN) {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: clip.clipKey, Body: fs.readFileSync(clip.clipPath), ContentType: 'video/mp4',
      }));
    }
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}uploaded ${clip.name} → ${clip.clipUrl}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
