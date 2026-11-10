#!/usr/bin/env node
// seed-db.mjs — Insert (or refresh) video records for all test clips.
//
// Run the seeder first (`node seeder.mjs`) so that *.magnet.txt files
// exist, then in another terminal: `node seed-db.mjs`

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/tortok';
const HTTP_ORIGIN =
  process.env.HTTP_ORIGIN ?? 'http://localhost:8090';

// The first user in the DB (testuser). Override with USER_ID env var.
const USER_ID =
  process.env.USER_ID ?? '7f5e1f1d-bec4-4a9c-882e-7d97ce63cf60';

const CLIPS = [
  { name: 'bbb-01', caption: 'Big Buck Bunny — opening shot' },
  { name: 'bbb-02', caption: 'Big Buck Bunny — butterfly scene' },
  { name: 'bbb-03', caption: 'Big Buck Bunny — the chase' },
  { name: 'bbb-04', caption: 'Big Buck Bunny — squirrel tricks' },
  { name: 'bbb-05', caption: 'Big Buck Bunny — finale' },
];

const client = new pg.Client(DATABASE_URL);

async function main() {
  await client.connect();

  // The owner of the clips. Created if missing, so a fresh database (such as
  // the one scripts/e2e-up.sh makes) needs no other setup.
  await client.query(
    `INSERT INTO users (id, username, display_name, email, password_hash, instance_domain)
     VALUES ($1, 'testuser', 'Test User', 'test@example.com', 'no-login', 'localhost')
     ON CONFLICT DO NOTHING`,
    [USER_ID],
  );

  // Clear stale video records (and cascaded likes/views/hashtag links).
  await client.query('DELETE FROM video_hashtags');
  await client.query('DELETE FROM views');
  await client.query('DELETE FROM likes');
  await client.query('DELETE FROM videos');
  console.log('🗑️  Cleared old video records.\n');

  for (const clip of CLIPS) {
    const magnetPath = path.join(__dirname, `${clip.name}.magnet.txt`);
    if (!fs.existsSync(magnetPath)) {
      console.error(
        `❌ ${magnetPath} not found — run the seeder first (node seeder.mjs)`,
      );
      process.exit(1);
    }

    const magnetLink = fs.readFileSync(magnetPath, 'utf-8').trim();
    const torrentFileUrl = `${HTTP_ORIGIN}/${clip.name}.torrent`;
    const posterUrl = `${HTTP_ORIGIN}/posters/${clip.name}.jpg`;

    const result = await client.query(
      `INSERT INTO videos
         (user_id, caption, magnet_link, torrent_file_url, poster_url,
          duration_seconds, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [USER_ID, clip.caption, magnetLink, torrentFileUrl, posterUrl, 20, 608, 1080],
    );

    console.log(`✅ ${clip.name} → ${result.rows[0].id}`);
    console.log(`   caption: ${clip.caption}`);
    console.log(`   magnet:  ${magnetLink.slice(0, 70)}…\n`);
  }

  console.log(`🎉 ${CLIPS.length} videos inserted. Start the app to see them in the feed.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
