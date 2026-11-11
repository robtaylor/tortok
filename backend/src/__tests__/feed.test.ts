// Integration tests for the feed routes against a real Postgres (Decision
// 0016, commitment 2): records go in through the ingest service, as in
// production, and come out of GET /videos/feed and GET /videos/:id.

import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Identity, Profile } from '../atproto/identity';
import { createTestDb, TestDb } from './helpers/testDb';
import { validRecord } from './helpers/fixtures';
import { VIDEO_POST_NSID } from '../atproto/videoPost';

const NSID = VIDEO_POST_NSID;
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const PDS = 'https://pds.example.com';
const BLOB_BASE = 'https://appview.example.com';

let testDb: TestDb;
let db: typeof import('../db');
let ingest: import('../services/atprotoIngest').AtprotoIngest;
let server: http.Server;
let base: string;

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
  // routes/videos still loads the legacy JWT middleware until 2.5C removes it.
  process.env.JWT_SECRET ??= 'test-only';
  db = await import('../db');
  await db.initializeDatabase();
  const { AtprotoIngest } = await import('../services/atprotoIngest');
  ingest = new AtprotoIngest({
    identity: identity as any,
    wsFactory: () => { throw new Error('no Jetstream in tests'); },
    fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch,
  });
  const app = express();
  app.use('/videos', (await import('../routes/videos')).default);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db?.closeDatabase();
  await testDb?.drop();
  delete process.env.PUBLIC_BASE_URL;
});

beforeEach(async () => {
  await db.query('TRUNCATE posts, profiles, ingest_cursor, known_accounts');
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

async function index(did: string, rkey: string, record: Record<string, unknown>) {
  await ingest.handleEvent({ did, time_us: 1, kind: 'commit', commit: { operation: 'create', collection: NSID, rkey, cid: `bafyrec${rkey}`, record } });
  await ingest.whenProfilesSettled();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getJson = async (path: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};

describe('GET /videos/feed', () => {
  it('serves an indexed post in the feed shape', async () => {
    await index(ALICE, '3kabc', validRecord());
    const { status, body } = await getJson('/videos/feed');
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
    const { body } = await getJson('/videos/feed');
    expect(body.videos[0].author).toEqual({ did: BOB, handle: null, displayName: null, avatarURL: null });
    expect(body.videos[0].playback.torrentFileUrl).toBeNull();
  });

  it('orders newest first and pages by offset', async () => {
    for (const [rkey, day] of [['a', '10'], ['b', '12'], ['c', '11']]) {
      await index(ALICE, rkey, validRecord({ createdAt: `2026-11-${day}T00:00:00.000Z` }));
    }
    const first = await getJson('/videos/feed?limit=2');
    expect(first.body.videos.map((v: { id: string }) => v.id.split('/').pop())).toEqual(['b', 'c']);
    expect(first.body).toMatchObject({ nextCursor: '2', hasMore: true });
    const second = await getJson('/videos/feed?limit=2&offset=2');
    expect(second.body.videos.map((v: { id: string }) => v.id.split('/').pop())).toEqual(['a']);
    expect(second.body).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it('serves nothing when nothing is indexed', async () => {
    expect((await getJson('/videos/feed')).body).toEqual({ videos: [], nextCursor: null, hasMore: false });
  });
});

describe('GET /videos/:id', () => {
  it('serves one post by its URL-encoded AT-URI', async () => {
    await index(ALICE, '3kabc', validRecord());
    const uri = `at://${ALICE}/${NSID}/3kabc`;
    const { status, body } = await getJson(`/videos/${encodeURIComponent(uri)}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: uri, caption: 'Big Buck Bunny' });
  });

  it('404s for an unknown post', async () => {
    const { status } = await getJson(`/videos/${encodeURIComponent(`at://${ALICE}/${NSID}/nope`)}`);
    expect(status).toBe(404);
  });
});
