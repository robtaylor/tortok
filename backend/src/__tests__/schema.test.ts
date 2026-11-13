// schema.sql runs on every boot. Its 2.5C block drops the legacy native
// tables, but only while they still have their legacy shape, so a later
// table that reuses a name (likes, follows, views) survives every boot.

import { createTestDb, TestDb } from './helpers/testDb';

let testDb: TestDb;
let db: typeof import('../db');

const tables = async (): Promise<string[]> =>
  (await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename",
  )).map((r) => r.tablename);

beforeAll(async () => {
  testDb = await createTestDb();
  db = await import('../db');
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});

afterAll(async () => {
  jest.restoreAllMocks();
  await db?.closeDatabase();
  await testDb?.drop();
});

test('drops legacy tables and keeps a new table that reuses a legacy name', async () => {
  // The legacy shapes, cut down to the columns the guard checks, with the
  // foreign keys that force children to go first.
  await db.query(`
    CREATE TABLE users (id UUID PRIMARY KEY, password_hash TEXT);
    CREATE TABLE videos (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), poster_url TEXT);
    CREATE TABLE hashtags (id UUID PRIMARY KEY, usage_count INTEGER);
    CREATE TABLE video_hashtags (video_id UUID REFERENCES videos(id), hashtag_id UUID REFERENCES hashtags(id));
    CREATE TABLE follows (id UUID PRIMARY KEY, follower_id UUID REFERENCES users(id), follower_instance TEXT);
    CREATE TABLE views (id UUID PRIMARY KEY, video_id UUID REFERENCES videos(id), watched_duration INTEGER);
    -- A later phase's likes table, not the legacy one.
    CREATE TABLE likes (at_uri TEXT PRIMARY KEY, subject TEXT);
    INSERT INTO likes VALUES ('at://did:plc:a/app.bsky.feed.like/1', 'at://did:plc:b/app.tortok.video.post/1');
  `);

  await db.initializeDatabase();
  expect(await tables()).toEqual(['bridge_authors', 'ingest_cursor', 'known_accounts', 'labels', 'likes', 'posts', 'profiles']);
  expect(await db.query('SELECT * FROM likes')).toHaveLength(1);

  // A second boot changes nothing.
  await db.initializeDatabase();
  expect(await tables()).toEqual(['bridge_authors', 'ingest_cursor', 'known_accounts', 'labels', 'likes', 'posts', 'profiles']);
});
