// scripts/r2-smoke-test.mjs
//
// Round-trips a tiny test object against the configured R2 bucket
// using the S3-compatible API. Confirms that the credentials in
// .env can list, read, write, and delete — the four operations
// the Phase 0b seeder will eventually need.
//
// Usage:
//   cp .env.example .env       # then fill in R2_* values
//   npm run smoke:r2
//
// What it does:
//   1. List buckets (auth check + confirms R2_BUCKET exists)
//   2. List up to 5 objects in R2_BUCKET (read access)
//   3. Upload a small text object under _smoke-test/ (write access)
//   4. Read it back; verify byte-for-byte (round-trip)
//   5. Delete the test object (cleanup; runs in finally so an
//      earlier failure still cleans up)

import 'dotenv/config';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET ?? 'tortok-content';
const R2_ENDPOINT =
  process.env.R2_ENDPOINT ??
  (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
  console.error(
    'Missing R2 env vars. Set the following in .env:\n' +
      '  R2_ACCOUNT_ID\n' +
      '  R2_ACCESS_KEY_ID\n' +
      '  R2_SECRET_ACCESS_KEY\n' +
      '  R2_BUCKET           (default: tortok-content)\n' +
      '  R2_ENDPOINT         (default: derived from account ID)',
  );
  process.exit(1);
}

const log = (msg) => console.log(`[r2-smoke] ${msg}`);

const client = new S3Client({
  // R2 ignores region but the SDK requires the field. "auto" is
  // R2's documented value.
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ---------- Step 1: list buckets ----------
log('listing buckets...');
const buckets = await client.send(new ListBucketsCommand({}));
const bucketNames = (buckets.Buckets ?? []).map((b) => b.Name);
log(`found ${bucketNames.length} bucket(s): ${bucketNames.join(', ') || '(none)'}`);
if (!bucketNames.includes(R2_BUCKET)) {
  throw new Error(
    `Bucket '${R2_BUCKET}' not visible to these credentials. ` +
      'Either the token lacks access, or R2_BUCKET is wrong.',
  );
}

// ---------- Step 2: list objects ----------
log(`listing objects in ${R2_BUCKET} (max 5)...`);
const list = await client.send(
  new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 5 }),
);
log(`bucket contains ${list.KeyCount ?? 0} object(s) (showing up to 5):`);
for (const o of list.Contents ?? []) {
  log(`  - ${o.Key} (${o.Size} bytes)`);
}

// ---------- Step 3+4+5: upload, read back, delete ----------
const testKey = `_smoke-test/${new Date()
  .toISOString()
  .replace(/[:.]/g, '-')}.txt`;
const testBody = `R2 smoke test from tortok at ${new Date().toISOString()}\n`;

log(`uploading ${testKey} (${testBody.length} bytes)...`);
let uploadSucceeded = false;
try {
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: testKey,
      Body: testBody,
      ContentType: 'text/plain',
    }),
  );
  uploadSucceeded = true;
  log('upload OK');

  log('reading back...');
  const got = await client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: testKey }),
  );
  const gotBody = await got.Body.transformToString();
  if (gotBody !== testBody) {
    throw new Error(
      `Round-trip body mismatch: uploaded ${testBody.length} bytes, ` +
        `read back ${gotBody.length} bytes`,
    );
  }
  log(`round-trip OK (${gotBody.length} bytes match)`);
} finally {
  if (uploadSucceeded) {
    log(`deleting ${testKey}...`);
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: testKey }),
      );
      log('delete OK');
    } catch (err) {
      console.error(
        `[r2-smoke] WARNING: failed to delete ${testKey}; clean up manually.`,
        err,
      );
    }
  }
}

console.log('\n✓ R2 smoke test passed');
console.log(`  Bucket:    ${R2_BUCKET}`);
console.log(`  Endpoint:  ${R2_ENDPOINT}`);
console.log(`  Verified:  list-buckets + list-objects + put + get + delete`);
