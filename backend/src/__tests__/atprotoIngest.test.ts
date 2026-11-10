// Integration tests for the ingest service against a real Postgres
// (Decision 0016, commitment 2). Jetstream, DID resolution and PDS calls
// are stubbed; the SQL is not.

import { EventEmitter } from 'events';
import type { Identity, Profile } from '../atproto/identity';
import type { AtprotoIngest as AtprotoIngestT, IngestOptions, WebSocketLike } from '../services/atprotoIngest';
import { createTestDb, TestDb } from './helpers/testDb';
import { INFO_HASH, validRecord } from './helpers/fixtures';

const NSID = 'app.tortok.video.post';
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const PDS = 'https://pds.example.com';

let testDb: TestDb;
let db: typeof import('../db');
let AtprotoIngest: typeof AtprotoIngestT;

beforeAll(async () => {
  testDb = await createTestDb();
  db = await import('../db');
  ({ AtprotoIngest } = await import('../services/atprotoIngest'));
  await db.initializeDatabase();
});

afterAll(async () => {
  await db?.closeDatabase();
  await testDb?.drop();
});

beforeEach(async () => {
  await db.query('TRUNCATE posts, profiles, ingest_cursor, known_accounts');
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

class FakeSocket extends EventEmitter implements WebSocketLike {
  closed = false;
  constructor(public url: string) { super(); }
  close() { this.closed = true; }
}

/** Identity stub: every DID lives on PDS with a fixed handle. */
const fakeIdentity = {
  profileCalls: 0,
  async resolve(did: string): Promise<Identity> {
    return { did, handle: `${did.slice(8, 12)}.example.com`, pdsEndpoint: PDS };
  },
  async profile(did: string): Promise<Profile> {
    this.profileCalls++;
    return { ...(await this.resolve(did)), displayName: 'Test', avatarCid: 'bafkavatar' };
  },
};

function makeIngest(opts: IngestOptions = {}) {
  const sockets: FakeSocket[] = [];
  const ingest = new AtprotoIngest({
    identity: fakeIdentity as any,
    wsFactory: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch,
    ...opts,
  });
  return { ingest, sockets };
}

function commit(did: string, rkey: string, operation: string, record?: unknown, cid = 'bafyrecord1', time_us = 1_000) {
  return { did, time_us, kind: 'commit', commit: { operation, collection: NSID, rkey, cid, record } };
}

const posts = () => db.query('SELECT * FROM posts ORDER BY at_uri');

describe('AtprotoIngest: Jetstream events', () => {
  it('indexes a created record and its author', async () => {
    const { ingest } = makeIngest();
    await ingest.handleEvent(commit(ALICE, '3kabc', 'create', validRecord()));
    await ingest.whenProfilesSettled();

    const [row] = await posts();
    expect(row).toMatchObject({
      at_uri: `at://${ALICE}/${NSID}/3kabc`, did: ALICE, collection: NSID, rkey: '3kabc',
      cid: 'bafyrecord1', text: 'Big Buck Bunny', thumbnail_cid: 'bafkthumb', torrent_cid: 'bafktorrent',
      duration_ms: 20_000, width: 608, height: 1080, hashtags: ['#bbb', '#test'], info_hash: INFO_HASH,
    });
    expect(row.record_created_at).toEqual(new Date('2026-11-10T12:00:00.000Z'));
    expect(await db.query('SELECT did, source FROM known_accounts')).toEqual([{ did: ALICE, source: 'jetstream' }]);
    expect(await db.query('SELECT handle, display_name, avatar_cid, pds_endpoint FROM profiles')).toEqual([
      { handle: 'aaaa.example.com', display_name: 'Test', avatar_cid: 'bafkavatar', pds_endpoint: PDS },
    ]);
  });

  it('replaces a row only when the record CID changes', async () => {
    const { ingest } = makeIngest();
    await ingest.handleEvent(commit(ALICE, '3kabc', 'create', validRecord()));
    const [first] = await posts();
    await ingest.handleEvent(commit(ALICE, '3kabc', 'update', validRecord({ caption: 'ignored' })));
    expect((await posts())[0]).toEqual(first);

    await ingest.handleEvent(commit(ALICE, '3kabc', 'update', validRecord({ caption: 'edited' }), 'bafyrecord2'));
    expect((await posts())[0]).toMatchObject({ cid: 'bafyrecord2', text: 'edited' });
  });

  it('deletes on a delete event', async () => {
    const { ingest } = makeIngest();
    await ingest.handleEvent(commit(ALICE, '3kabc', 'create', validRecord()));
    await ingest.handleEvent(commit(ALICE, '3kabc', 'delete'));
    expect(await posts()).toEqual([]);
  });

  it('skips an invalid record, and an invalid edit removes the old version', async () => {
    const { ingest } = makeIngest();
    await ingest.handleEvent(commit(ALICE, 'bad', 'create', validRecord({ infoHash: 'b'.repeat(40) })));
    expect(await posts()).toEqual([]);
    expect(await db.query('SELECT * FROM known_accounts')).toEqual([]);

    await ingest.handleEvent(commit(ALICE, '3kabc', 'create', validRecord()));
    await ingest.handleEvent(commit(ALICE, '3kabc', 'update', validRecord({ durationMs: -1 }), 'bafyrecord2'));
    expect(await posts()).toEqual([]);
  });

  it('ignores other collections and malformed identifiers', async () => {
    const { ingest } = makeIngest();
    await ingest.handleEvent({ ...commit(ALICE, '3kabc', 'create', validRecord()), commit: {
      operation: 'create', collection: 'app.bsky.feed.post', rkey: '3kabc', cid: 'c', record: {} } });
    await ingest.handleEvent(commit('did:example:nope', '3kabc', 'create', validRecord()));
    await ingest.handleEvent(commit(ALICE, 'bad/rkey', 'create', validRecord()));
    expect(await posts()).toEqual([]);
  });

  it("doesn't refetch a fresh profile, but an identity event forces it", async () => {
    const { ingest } = makeIngest();
    fakeIdentity.profileCalls = 0;
    await ingest.handleEvent(commit(ALICE, 'r1', 'create', validRecord()));
    await ingest.whenProfilesSettled();
    await ingest.handleEvent(commit(ALICE, 'r2', 'create', validRecord()));
    await ingest.whenProfilesSettled();
    expect(fakeIdentity.profileCalls).toBe(1);
    await ingest.handleEvent({ did: ALICE, kind: 'identity' });
    expect(fakeIdentity.profileCalls).toBe(2);
    await ingest.handleEvent({ did: BOB, kind: 'identity' });
    expect(fakeIdentity.profileCalls).toBe(2);
  });
});

describe('AtprotoIngest: cursor', () => {
  it('saves the cursor on stop and resumes a few seconds back', async () => {
    const first = makeIngest();
    await first.ingest.start();
    expect(first.sockets[0].url).toBe(
      'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.tortok.video.post');
    first.sockets[0].emit('message', Buffer.from(JSON.stringify(commit(ALICE, 'r1', 'create', validRecord(), 'c', 20_000_000))));
    await first.ingest.stop();
    expect(first.sockets[0].closed).toBe(true);
    expect(await db.query('SELECT cursor FROM ingest_cursor')).toEqual([{ cursor: '20000000' }]);
    expect(await posts()).toHaveLength(1);

    const second = makeIngest();
    await second.ingest.start();
    expect(new URL(second.sockets[0].url).searchParams.get('cursor')).toBe('15000000');
    await second.ingest.stop();
  });

  it('reconnects after the socket closes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const { ingest, sockets } = makeIngest();
      await ingest.start();
      sockets[0].emit('close', 1006, Buffer.alloc(0));
      jest.advanceTimersByTime(1_000);
      expect(sockets).toHaveLength(2);
      await ingest.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AtprotoIngest: backfill', () => {
  /** A PDS stub serving ALICE's records in pages of two. */
  function pdsWith(records: { rkey: string; cid: string; value: unknown }[]): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(`${PDS}/xrpc/com.atproto.repo.listRecords`);
      expect(url.searchParams.get('repo')).toBe(ALICE);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const page = records.slice(start, start + 2).map((r) => ({ uri: `at://${ALICE}/${NSID}/${r.rkey}`, ...r }));
      const next = start + 2 < records.length ? String(start + 2) : undefined;
      return new Response(JSON.stringify({ records: page, cursor: next }), { status: 200 });
    }) as typeof fetch;
  }

  it('lists every page, indexes valid records and removes rows the PDS no longer has', async () => {
    const { ingest: live } = makeIngest();
    await live.handleEvent(commit(ALICE, 'gone', 'create', validRecord()));
    await db.query("UPDATE posts SET indexed_at = NOW() - INTERVAL '1 hour'");

    const { ingest } = makeIngest({
      seedDids: [ALICE],
      fetch: pdsWith([
        { rkey: 'r1', cid: 'c1', value: validRecord() },
        { rkey: 'r2', cid: 'c2', value: validRecord({ caption: 'two' }) },
        { rkey: 'r3', cid: 'c3', value: validRecord({ durationMs: 0 }) },
      ]),
    });
    await ingest.start();
    await ingest.whenBackfilled();
    await ingest.stop();

    expect((await posts()).map((p) => p.rkey)).toEqual(['r1', 'r2']);
    // The first source to see an account is kept.
    expect(await db.query('SELECT did, source FROM known_accounts')).toEqual([{ did: ALICE, source: 'jetstream' }]);
  });

  it('records seed accounts as seed', async () => {
    const { ingest } = makeIngest({ seedDids: [BOB] });
    await ingest.start();
    await ingest.stop();
    expect(await db.query('SELECT did, source FROM known_accounts')).toEqual([{ did: BOB, source: 'seed' }]);
  });

  it('runs on its own, without start(): prunes, saves the profile, keeps rows indexed mid-listing', async () => {
    const { ingest } = makeIngest({ fetch: pdsWith([]) });
    await ingest.handleEvent(commit(ALICE, 'stale', 'create', validRecord()));
    await ingest.whenProfilesSettled();
    await db.query("UPDATE posts SET indexed_at = NOW() - INTERVAL '1 hour'");
    await db.query('DELETE FROM profiles');

    const backfill = ingest.backfill(ALICE);
    await ingest.handleEvent(commit(ALICE, 'fresh', 'create', validRecord()));
    await backfill;
    expect((await posts()).map((p) => p.rkey)).toEqual(['fresh']);
    expect(await db.query('SELECT did FROM profiles')).toEqual([{ did: ALICE }]);
  });

  it('rejects an invalid seed DID up front', () => {
    expect(() => makeIngest({ seedDids: ['alice.example.com'] })).toThrow(/seed DID/);
  });
});
