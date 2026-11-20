// JetstreamSubscription: the cursor moves only past handled events, and a
// failing handler, a backed-up queue or a silent socket resyncs from the last
// one handled. A deep queue pauses the socket first.
// The database is stubbed: only the cursor row matters here.

import { once } from 'events';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import { parseCommit, JetstreamSubscription } from '../services/jetstream';
import type { JetstreamEvent } from '../services/jetstream';
import type { QueryFn } from '../db';
import { fakeSockets } from './helpers/fakeSocket';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const NSID = 'app.bsky.feed.post';
const SILENCE_MS = 60_000;

/** A db stub: no saved cursor; records each cursor it is asked to save. */
function cursorDb() {
  const saved: number[] = [];
  const db = (async (sql: string, params?: unknown[]) => {
    if (sql.includes('INSERT INTO ingest_cursor')) saved.push(Number(params![1]));
    return [];
  }) as QueryFn;
  return { db, saved };
}

/** A subscription on fake sockets and the stub db. */
function subscription(onEvent: (e: JetstreamEvent) => Promise<void> = async () => {}, collections = [NSID]) {
  const { db, saved } = cursorDb();
  const { sockets, wsFactory } = fakeSockets();
  const sub = new JetstreamSubscription({ tag: 't', collections, cursorKey: 'k', db, wsFactory, onEvent });
  return { sub, sockets, saved };
}

/** A handler that handles nothing until released. */
function blockedHandler() {
  let release!: () => void;
  const blocked = new Promise<void>((r) => { release = r; });
  return { onEvent: () => blocked, release };
}

const msg = (time_us: number) => ({ kind: 'commit', time_us });
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('a failed event resyncs from the last event handled, whatever the old socket still delivers', async () => {
  const handled: number[] = [];
  let failing = false;
  const { sub, sockets, saved } = subscription(async (e) => {
    if (failing) throw new Error('database down');
    handled.push(e.time_us!);
  });
  await sub.start();
  sockets[0].deliver(msg(10_000_000));
  await settle();
  failing = true;
  sockets[0].deliver(msg(11_000_000));
  sockets[0].deliver(msg(12_000_000));
  await settle();
  expect(sockets[0].closed).toBe(true);

  failing = false;
  // Jetstream was mid-replay: the socket left behind still delivers.
  // Handling this would move the cursor past the events that failed.
  sockets[0].deliver(msg(13_000_000));
  await settle();
  jest.advanceTimersByTime(1_000);
  expect(sockets).toHaveLength(2);
  // Resumes 5 s before the last handled event, not after the failed ones.
  expect(new URL(sockets[1].url).searchParams.get('cursor')).toBe('5000000');
  await sub.stop();
  expect(handled).toEqual([10_000_000]);
  expect(saved).toEqual([10_000_000]);
});

test('a backed-up queue resyncs instead of buffering', async () => {
  const { onEvent, release } = blockedHandler();
  const { sub, sockets } = subscription(onEvent);
  await sub.start();
  for (let i = 1; i <= 5_001; i++) sockets[0].deliver(msg(i));
  expect(sockets[0].closed).toBe(true);
  release();
  await sub.stop();
});

test('a deep queue pauses the socket until it drains, and that quiet is not taken for silence', async () => {
  const { onEvent, release } = blockedHandler();
  const { sub, sockets, saved } = subscription(onEvent);
  await sub.start();
  try {
    for (let i = 1; i < 1_000; i++) sockets[0].deliver(msg(i));
    expect(sockets[0].isPaused).toBe(false);
    sockets[0].deliver(msg(1_000));
    expect(sockets[0].isPaused).toBe(true);
    // The quiet is ours: the silence check leaves a paused socket alone.
    jest.advanceTimersByTime(3 * SILENCE_MS - 1);
    expect(sockets[0].closed).toBe(false);

    release();
    await settle();
    expect(sockets[0].isPaused).toBe(false);
    // Read again just before a check, it is not dropped for that quiet either.
    jest.advanceTimersByTime(1);
    expect(sockets[0].closed).toBe(false);
  } finally {
    release();
    await sub.stop();
  }
  // Nothing was dropped on the way.
  expect(saved).toEqual([1_000]);
});

test('a silent socket is dropped, and the subscription connects again from the last event handled', async () => {
  const { sub, sockets } = subscription();
  await sub.start();
  // While events keep arriving, however slowly, the socket is kept.
  for (let i = 1; i <= 3; i++) {
    jest.advanceTimersByTime(SILENCE_MS - 1);
    sockets[0].deliver(msg(i * 10_000_000));
    await settle();
  }
  expect(sockets[0].closed).toBe(false);

  // Then nothing: no close, no error. Jetstream did this on 2026-11-19.
  // The peer may be dead, so the socket is dropped without a closing handshake.
  jest.advanceTimersByTime(2 * SILENCE_MS);
  expect(sockets[0].terminated).toBe(true);
  jest.advanceTimersByTime(1_000);
  expect(sockets).toHaveLength(2);
  expect(new URL(sockets[1].url).searchParams.get('cursor')).toBe('25000000');

  // A socket that never delivers anything goes the same way.
  jest.advanceTimersByTime(2 * SILENCE_MS);
  expect(sockets[1].closed).toBe(true);
  await sub.stop();
});

test('a subscription reports itself stalled once its cursor has not moved for five minutes', async () => {
  const { sub, sockets } = subscription();
  await sub.start();
  sockets[0].deliver(msg(10_000_000));
  await settle();
  // Replayed events are handled and move nothing. On 2026-11-19 each new
  // socket would have delivered its 5 s rewind and then gone quiet.
  for (let minute = 1; minute <= 5; minute++) {
    jest.advanceTimersByTime(SILENCE_MS);
    sockets.at(-1)!.deliver(msg(10_000_000));
    await settle();
    expect(sub.stalled()).toBe(false);
  }
  jest.advanceTimersByTime(1);
  expect(sub.stalled()).toBe(true);

  sockets.at(-1)!.deliver(msg(11_000_000));
  await settle();
  expect(sub.stalled()).toBe(false);
  await sub.stop();
});

// The fake socket can't be flooded: what it is given, it delivers. This one is
// the `ws` the service runs on, against a server that sends as fast as it can.
test('a real socket flooded faster than events are handled is paused, and nothing is dropped', async () => {
  jest.useRealTimers();
  const TOTAL = 20_000;
  // The size of a post on the stream, so a read holds a realistic number of them.
  const padding = 'x'.repeat(500);
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let connections = 0;
  server.on('connection', (ws) => {
    connections++;
    for (let i = 1; i <= TOTAL; i++) ws.send(JSON.stringify({ ...msg(i), padding }));
  });
  await once(server, 'listening');

  const handled: number[] = [];
  let finished!: () => void;
  const all = new Promise<void>((r) => { finished = r; });
  const sub = new JetstreamSubscription({
    tag: 't', collections: [NSID], cursorKey: 'k', db: cursorDb().db,
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/subscribe`,
    onEvent: async (e) => {
      handled.push(e.time_us!);
      // Slower than the socket: every tenth event waits a turn of the event loop.
      if (handled.length % 10 === 0) await settle();
      if (handled.length >= TOTAL) finished();
    },
  });
  await sub.start();
  try {
    await all;
    // One connection: the queue never backed up far enough to resync.
    expect(connections).toBe(1);
    expect(handled).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1));
  } finally {
    await sub.stop();
    await new Promise((r) => server.close(r));
  }
});

test('subscribes to every collection it is given', async () => {
  const { sub, sockets } = subscription(undefined, ['a.b.c', 'd.e.f']);
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
