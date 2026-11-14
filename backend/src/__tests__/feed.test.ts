// Integration tests for the feed routes against a real Postgres (Decision
// 0016, commitment 2): records go in through the ingest service, as in
// production, and come out of GET /videos/feed and GET /videos/:id.

import type { Identity, Profile } from '../atproto/identity';
import { createTestDb, TestDb } from './helpers/testDb';
import { commitEvent } from './helpers/fakeSocket';
import { feedRkeys, startFeedServer, TestServer } from './helpers/testServer';
import { bskyPostUri, validRecord, VIDEO_CID, videoRecord } from './helpers/fixtures';
import { VIDEO_POST_NSID } from '../atproto/videoPost';
import { BSKY_POST_NSID } from '../atproto/bskyPost';

const NSID = VIDEO_POST_NSID;
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const PDS = 'https://pds.example.com';
const BLOB_BASE = 'https://appview.example.com';

let testDb: TestDb;
let db: typeof import('../db');
let ingest: import('../services/atprotoIngest').AtprotoIngest;
let firehose: import('../services/bskyFirehose').BskyFirehose;
let server: TestServer;

const identity = {
  async resolve(did: string): Promise<Identity> {
    return { did, handle: did === ALICE ? 'alice.example.com' : null, pdsEndpoint: PDS };
  },
  async profile(did: string): Promise<Profile> {
    const id = await this.resolve(did);
    return did === ALICE ? { ...id, displayName: 'Alice', avatarCid: 'bafkavatar' } : { ...id, displayName: null, avatarCid: null };
  },
};

beforeAll(async () => {
  testDb = await createTestDb();
  process.env.TRACKER_URLS = 'wss://tracker.example.com,wss://tracker2.example.com';
  process.env.PUBLIC_BASE_URL = `${BLOB_BASE}/`;
  db = await import('../db');
  await db.initializeDatabase();
  const { AtprotoIngest } = await import('../services/atprotoIngest');
  ingest = new AtprotoIngest({
    identity: identity as any,
    wsFactory: () => { throw new Error('no Jetstream in tests'); },
    fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch,
  });
  const { BskyFirehose } = await import('../services/bskyFirehose');
  firehose = new BskyFirehose({ wsFactory: () => { throw new Error('no Jetstream in tests'); } });
  server = await startFeedServer();
});

afterAll(async () => {
  server?.close();
  await db?.closeDatabase();
  await testDb?.drop();
  delete process.env.PUBLIC_BASE_URL;
});

beforeEach(async () => {
  await db.query('TRUNCATE posts, profiles, ingest_cursor, known_accounts, bridge_authors, labels');
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

async function index(did: string, rkey: string, record: Record<string, unknown>) {
  await ingest.handleEvent(commitEvent(NSID, did, rkey, 'create', record, `bafyrec${rkey}`));
  await ingest.whenProfilesSettled();
}

describe('GET /videos/feed', () => {
  it('serves an indexed post in the feed shape', async () => {
    await index(ALICE, '3kabc', validRecord());
    const { status, body } = await server.getJson('/videos/feed');
    expect(status).toBe(200);
    expect(body).toEqual({
      videos: [{
        id: `at://${ALICE}/${NSID}/3kabc`,
        cid: 'bafyrec3kabc',
        author: {
          did: ALICE,
          handle: 'alice.example.com',
          displayName: 'Alice',
          avatarURL: `${BLOB_BASE}/blob/${ALICE}/bafkavatar`,
        },
        caption: 'Big Buck Bunny',
        playback: {
          kind: 'torrent',
          magnetLink: validRecord().magnetUri,
          torrentFileUrl: `${BLOB_BASE}/blob/${ALICE}/bafktorrent`,
          sources: { webseeds: [], trackers: ['wss://tracker.example.com', 'wss://tracker2.example.com'] },
        },
        posterURL: `${BLOB_BASE}/blob/${ALICE}/bafkthumb`,
        durationSeconds: 20,
        width: 608,
        height: 1080,
        hashtags: ['#bbb', '#test'],
        createdAt: '2026-11-10T12:00:00.000Z',
      }],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('gives an unverified handle as null, and no blob URLs where there are no blobs', async () => {
    const record = validRecord();
    delete record.torrentBlob;
    await index(BOB, '3kbob', record);
    const { body } = await server.getJson('/videos/feed');
    expect(body.videos[0].author).toEqual({ did: BOB, handle: null, displayName: null, avatarURL: null });
    expect(body.videos[0].playback.torrentFileUrl).toBeNull();
  });

  it('orders newest first and pages by offset', async () => {
    for (const [rkey, day] of [['a', '10'], ['b', '12'], ['c', '11']]) {
      await index(ALICE, rkey, validRecord({ createdAt: `2026-11-${day}T00:00:00.000Z` }));
    }
    const first = await server.getJson('/videos/feed?limit=2');
    expect(feedRkeys(first.body)).toEqual(['b', 'c']);
    expect(first.body).toMatchObject({ nextCursor: '2', hasMore: true });
    const second = await server.getJson('/videos/feed?limit=2&offset=2');
    expect(feedRkeys(second.body)).toEqual(['a']);
    expect(second.body).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it('serves nothing when nothing is indexed', async () => {
    expect((await server.getJson('/videos/feed')).body).toEqual({ videos: [], nextCursor: null, hasMore: false });
  });
});

// Bridged rows go in through the firehose, as in production; the UPDATE
// stands in for the engagement poller qualifying them.
const BSKY = BSKY_POST_NSID;
async function bridged(did: string, rkey: string, createdAt: string, qualified = true) {
  const record = videoRecord({ text: 'from bluesky', createdAt }, { width: 1080, height: 1920 });
  await firehose.handleEvent(commitEvent(BSKY, did, rkey, 'create', record, 'bafyrec'));
  if (qualified) await db.query('UPDATE posts SET bridge_qualified_at = NOW() WHERE at_uri = $1', [`at://${did}/${BSKY}/${rkey}`]);
}

describe('GET /videos/feed: bridged Bluesky posts', () => {
  const CAROL = 'did:plc:cccccccccccccccccccccccc';

  it('serves qualified bridged posts as HLS, interleaved with native posts by createdAt', async () => {
    await index(ALICE, 'native', validRecord({ createdAt: '2026-11-02T00:00:00.000Z' }));
    await bridged(CAROL, 'newer', '2026-11-03T00:00:00.000Z');
    await bridged(CAROL, 'older', '2026-11-01T00:00:00.000Z');
    await bridged(CAROL, 'unqualified', '2026-11-04T00:00:00.000Z', false);
    await db.query(
      `INSERT INTO bridge_authors (did, handle, display_name, avatar_url, followers_count)
       VALUES ($1, 'carol.bsky.social', 'Carol', 'https://cdn.bsky.app/img/avatar/plain/carol', 9000)`, [CAROL]);

    const { body } = await server.getJson('/videos/feed');
    expect(feedRkeys(body)).toEqual(['newer', 'native', 'older']);
    const item = body.videos[0];
    expect(item).toEqual({
      id: `at://${CAROL}/${BSKY}/newer`,
      cid: 'bafyrec',
      author: { did: CAROL, handle: 'carol.bsky.social', displayName: 'Carol', avatarURL: 'https://cdn.bsky.app/img/avatar/plain/carol' },
      caption: 'from bluesky',
      playback: { kind: 'hls', url: `https://video.bsky.app/watch/did%3Aplc%3Acccccccccccccccccccccccc/${VIDEO_CID}/playlist.m3u8` },
      posterURL: `https://video.bsky.app/watch/did%3Aplc%3Acccccccccccccccccccccccc/${VIDEO_CID}/thumbnail.jpg`,
      durationSeconds: 0,
      width: 1080,
      height: 1920,
      hashtags: ['#cats'],
      createdAt: '2026-11-03T00:00:00.000Z',
    });
    expect(body.videos[1].playback.kind).toBe('torrent');

    const one = await server.getJson(`/videos/${encodeURIComponent(`at://${CAROL}/${BSKY}/older`)}`);
    expect(one.body).toMatchObject({ playback: { kind: 'hls' } });
    const hidden = await server.getJson(`/videos/${encodeURIComponent(`at://${CAROL}/${BSKY}/unqualified`)}`);
    expect(hidden.status).toBe(404);
  });

  /** Set when a bridged post's next check is due, as an interval from now; null for no date. */
  const checkDue = (rkey: string, due: string | null) =>
    db.query('UPDATE posts SET bridge_next_check_at = NOW() + $2::interval WHERE at_uri = $1', [bskyPostUri(CAROL, rkey), due]);
  const byId = (rkey: string) => server.getJson(`/videos/${encodeURIComponent(bskyPostUri(CAROL, rkey))}`);

  it('leaves out a bridged post whose check is more than a day overdue, in the feed and by id (Decision 0025)', async () => {
    await index(ALICE, 'native', validRecord({ createdAt: '2026-11-05T00:00:00.000Z' }));
    await bridged(CAROL, 'late', '2026-11-03T00:00:00.000Z');
    await checkDue('late', '-23 hours');
    await bridged(CAROL, 'overdue', '2026-11-02T00:00:00.000Z');
    await checkDue('overdue', '-25 hours');

    expect(feedRkeys((await server.getJson('/videos/feed')).body)).toEqual(['native', 'late']);
    expect((await byId('late')).status).toBe(200);
    expect((await byId('overdue')).status).toBe(404);
  });

  it('does not serve a qualified post with no check date, nor once a boot has queued it for the poller', async () => {
    await bridged(CAROL, 'undated', '2026-11-01T00:00:00.000Z');
    await checkDue('undated', null);
    expect((await byId('undated')).status).toBe(404);

    await db.initializeDatabase(); // schema.sql gives it a check date
    const [row] = await db.query<{ due: boolean }>(
      'SELECT bridge_next_check_at <= NOW() AS due FROM posts WHERE at_uri = $1', [bskyPostUri(CAROL, 'undated')]);
    expect(row.due).toBe(true);
    expect((await byId('undated')).status).toBe(404);
  });

  it('reads a page from the feed index, not by scanning bridged rows', async () => {
    // A tiny table gets a seq scan or a bitmap scan plus sort, so turn those
    // off: what's left shows that the WHERE clause still matches
    // idx_posts_feed's predicate and that the index gives feed order.
    const { FEED_PAGE_SQL } = await import('../services/feedView');
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('SET enable_seqscan = off; SET enable_bitmapscan = off');
      const plan = (await c.query(`EXPLAIN ${FEED_PAGE_SQL}`, [new Date(), 20, 0])).rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/Index Scan using idx_posts_feed/);
      expect(plan).not.toMatch(/Sort/);
    } finally {
      await c.end();
    }
  });

  it("uses the author's profiles row over bridge_authors, and copes with neither", async () => {
    // Direct, not through ingest: its in-memory freshness cache outlives TRUNCATE.
    await db.query(
      `INSERT INTO profiles (did, handle, display_name, avatar_cid, pds_endpoint)
       VALUES ($1, 'alice.example.com', 'Alice', 'bafkavatar', $2)`, [ALICE, PDS]);
    await bridged(ALICE, 'bsky', '2026-11-03T00:00:00.000Z');
    await bridged(CAROL, 'anon', '2026-11-02T00:00:00.000Z');
    await db.query(`INSERT INTO bridge_authors (did, handle) VALUES ($1, 'alice.bsky.social')`, [ALICE]);

    const { body } = await server.getJson('/videos/feed');
    const byRkey = Object.fromEntries(body.videos.map((v: { id: string }) => [v.id.split('/').pop(), v]));
    expect(byRkey.bsky.author).toEqual({
      did: ALICE, handle: 'alice.example.com', displayName: 'Alice', avatarURL: `${BLOB_BASE}/blob/${ALICE}/bafkavatar`,
    });
    expect(byRkey.anon.author).toEqual({ did: CAROL, handle: null, displayName: null, avatarURL: null });
  });
});

describe('GET /videos/:id', () => {
  it('serves one post by its URL-encoded AT-URI', async () => {
    await index(ALICE, '3kabc', validRecord());
    const uri = `at://${ALICE}/${NSID}/3kabc`;
    const { status, body } = await server.getJson(`/videos/${encodeURIComponent(uri)}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: uri, caption: 'Big Buck Bunny' });
  });

  it('404s for an unknown post', async () => {
    const { status } = await server.getJson(`/videos/${encodeURIComponent(`at://${ALICE}/${NSID}/nope`)}`);
    expect(status).toBe(404);
  });
});
