// JetstreamSubscription: the cursor moves only past handled events, and a
// failing handler or a backed-up queue resyncs from the last one handled.
// The database is stubbed: only the cursor row matters here.

import { parseCommit, JetstreamSubscription } from '../services/jetstream';
import type { JetstreamEvent } from '../services/jetstream';
import type { QueryFn } from '../db';
import { fakeSockets } from './helpers/fakeSocket';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const NSID = 'app.bsky.feed.post';

/** A db stub: no saved cursor; records each cursor it is asked to save. */
function cursorDb() {
  const saved: number[] = [];
  const db = (async (sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT INTO ingest_cursor')) saved.push(Number(params![1]));
    return [];
  }) as QueryFn;
  return { db, saved };
}

const msg = (time_us: number) => Buffer.from(JSON.stringify({ kind: 'commit', time_us }));
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('a failed event resyncs from the last event handled', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  try {
    const { db, saved } = cursorDb();
    const { sockets, wsFactory } = fakeSockets();
    const handled: number[] = [];
    let failing = false;
    const sub = new JetstreamSubscription({
      tag: 't', collections: [NSID], cursorKey: 'k', db, wsFactory,
      onEvent: async (e: JetstreamEvent) => {
        if (failing) throw new Error('database down');
        handled.push(e.time_us!);
      },
    });
    await sub.start();
    sockets[0].emit('message', msg(10_000_000));
    await settle();
    failing = true;
    sockets[0].emit('message', msg(11_000_000));
    sockets[0].emit('message', msg(12_000_000));
    await settle();
    expect(sockets[0].closed).toBe(true);

    failing = false;
    jest.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    // Resumes 5 s before the last handled event, not after the failed ones.
    expect(new URL(sockets[1].url).searchParams.get('cursor')).toBe('5000000');
    await sub.stop();
    expect(handled).toEqual([10_000_000]);
    expect(saved).toEqual([10_000_000]);
  } finally {
    jest.useRealTimers();
  }
});

test('a backed-up queue resyncs instead of buffering', async () => {
  const { db } = cursorDb();
  const { sockets, wsFactory } = fakeSockets();
  let release!: () => void;
  const blocked = new Promise<void>((r) => { release = r; });
  const sub = new JetstreamSubscription({
    tag: 't', collections: [NSID], cursorKey: 'k', db, wsFactory,
    onEvent: () => blocked,
  });
  await sub.start();
  for (let i = 1; i <= 5_001; i++) sockets[0].emit('message', msg(i));
  expect(sockets[0].closed).toBe(true);
  release();
  await sub.stop();
});

test('subscribes to every collection it is given', async () => {
  const { db } = cursorDb();
  const { sockets, wsFactory } = fakeSockets();
  const sub = new JetstreamSubscription({
    tag: 't', collections: ['a.b.c', 'd.e.f'], cursorKey: 'k', db, wsFactory, onEvent: async () => {},
  });
  await sub.start();
  expect(new URL(sockets[0].url).searchParams.getAll('wantedCollections')).toEqual(['a.b.c', 'd.e.f']);
  await sub.stop();
});

test('parseCommit checks the collection, identifiers, operation and CID', () => {
  const ev = (commit: object, did = DID) => ({ did, kind: 'commit', commit: { collection: NSID, rkey: '3k', ...commit } });
  expect(parseCommit(ev({ operation: 'create', cid: 'c', record: { a: 1 } }), NSID)).toEqual({
    did: DID, rkey: '3k', uri: `at://${DID}/${NSID}/3k`, operation: 'create', cid: 'c', record: { a: 1 },
  });
  expect(parseCommit(ev({ operation: 'delete' }), NSID)).toEqual({ did: DID, rkey: '3k', uri: `at://${DID}/${NSID}/3k`, operation: 'delete' });
  expect(parseCommit(ev({ operation: 'create', cid: 'c' }), 'other.nsid')).toBeNull();
  expect(parseCommit(ev({ operation: 'create', cid: 'c' }, 'did:example:x'), NSID)).toBeNull();
  expect(parseCommit(ev({ operation: 'create', cid: 'c', rkey: 'a/b' }), NSID)).toBeNull();
  expect(parseCommit(ev({ operation: 'create' }), NSID)).toBeNull();
  expect(parseCommit(ev({ operation: 'resync' }), NSID)).toBeNull();
  expect(parseCommit({ did: DID, kind: 'identity' }, NSID)).toBeNull();
});
