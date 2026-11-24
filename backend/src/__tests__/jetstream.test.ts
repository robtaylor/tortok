// JetstreamSubscription: the cursor moves only past handled events, and a
// failing handler, a backed-up queue or a silent socket resyncs from the last
// one handled. A deep queue pauses the socket first. An event that fails
// every time it is tried is skipped, so it can't hold the stream.
// The database is stubbed: only the cursor row matters here.

import { once } from 'events';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import { parseCommit, JetstreamSubscription } from '../services/jetstream';
import type { JetstreamEvent, JetstreamOptions } from '../services/jetstream';
import type { QueryFn } from '../db';
import { fakeSockets } from './helpers/fakeSocket';
import type { FakeSocket } from './helpers/fakeSocket';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const NSID = 'app.bsky.feed.post';
const SILENCE_MS = 60_000;

/** A db stub: no saved cursor; records each cursor it is asked to save. While `database.writes` is false it takes no write. */
function cursorDb() {
  const saved: number[] = [];
  const database = { writes: true };
  const db = (async (sql: string, params?: unknown[]) => {
    if (!database.writes && !sql.startsWith('SELECT')) throw new Error('the database takes no writes');
    if (sql.includes('INSERT INTO ingest_cursor')) saved.push(Number(params![1]));
    return [];
  }) as QueryFn;
  return { db, saved, database };
}

/** A subscription on fake sockets and the stub db. */
function subscription(onEvent: (e: JetstreamEvent) => Promise<void> = async () => {}, opts: Partial<JetstreamOptions> = {}) {
  const { db, saved, database } = cursorDb();
  const { sockets, wsFactory } = fakeSockets();
  const sub = new JetstreamSubscription({ tag: 't', collections: [NSID], cursorKey: 'k', db, wsFactory, onEvent, ...opts });
  return { sub, sockets, saved, database };
}

/** Run the clock until the subscription has reconnected; returns the new socket. */
function nextSocket(sockets: FakeSocket[]): FakeSocket {
  const before = sockets.length;
  for (let s = 0; s < 60 && sockets.length === before; s++) jest.advanceTimersByTime(1_000);
  expect(sockets).toHaveLength(before + 1);
  return sockets[before];
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

test('an event that fails every time it is tried is skipped, and the stream goes on', async () => {
  const handled: number[] = [];
  const skipped: number[] = [];
  const bad = new Set([11_000_000, 13_000_000]);
  const { sub, sockets, saved } = subscription(async (e) => {
    // Whatever the error. On 2026-11-22 it was a NUL Postgres refused, and the
    // bridge tried that one event for 36 hours; the next will be something else.
    if (bad.has(e.time_us!)) throw new Error('cannot be stored');
    handled.push(e.time_us!);
  }, { onSkip: async (e) => { skipped.push(e.time_us!); } });
  await sub.start();
  sockets[0].deliver(msg(10_000_000));
  // Twice it is taken for the database failing, and tried again from the cursor.
  for (const i of [0, 1]) {
    sockets[i].deliver(msg(11_000_000));
    await settle();
    expect(sockets[i].closed).toBe(true);
    nextSocket(sockets);
  }
  // The third time running, with the database taking writes, it is the event.
  sockets[2].deliver(msg(11_000_000));
  await settle();
  expect(sockets[2].closed).toBe(false);
  expect(skipped).toEqual([11_000_000]);

  // A reconnect replays it, from the cursor it now is. It fails again and is passed over, not skipped anew.
  sockets[2].deliver(msg(11_000_000));
  sockets[2].deliver(msg(12_000_000));
  await settle();
  expect(sockets[2].closed).toBe(false);
  expect(skipped).toEqual([11_000_000]);

  // The count was that event's: the next one to fail is tried again like any other.
  sockets[2].deliver(msg(13_000_000));
  await settle();
  expect(sockets[2].closed).toBe(true);
  await sub.stop();
  expect(handled).toEqual([10_000_000, 12_000_000]);
  expect(saved.at(-1)).toBe(12_000_000);
});

test('failures while the database takes no writes say nothing about the event, and are not counted', async () => {
  const { sub, sockets, saved, database } = subscription(async () => { throw new Error('database down'); });
  await sub.start();
  /** Deliver the event to the newest socket; true if the socket was dropped for it. */
  const droppedFor = async (timeUs: number) => {
    const socket = sockets.at(-1)!;
    socket.deliver(msg(timeUs));
    await settle();
    if (socket.closed) nextSocket(sockets);
    return socket.closed;
  };
  database.writes = false;
  for (let i = 0; i < 6; i++) expect(await droppedFor(10_000_000)).toBe(true);
  // The database is back and the event still fails. Only from here does that say anything about the event.
  database.writes = true;
  expect(await droppedFor(10_000_000)).toBe(true);
  expect(await droppedFor(10_000_000)).toBe(true);
  // Another outage, and the count starts again: it is of failures running with the database up.
  database.writes = false;
  expect(await droppedFor(10_000_000)).toBe(true);
  database.writes = true;
  expect(await droppedFor(10_000_000)).toBe(true);
  expect(await droppedFor(10_000_000)).toBe(true);
  expect(await droppedFor(10_000_000)).toBe(false);
  await sub.stop();
  expect(saved).toEqual([10_000_000]);
});

test('an event with no time on it is never skipped: there is nothing to tell its retries by', async () => {
  const { sub, sockets } = subscription(async () => { throw new Error('cannot be handled'); });
  await sub.start();
  for (let i = 0; i < 5; i++) {
    sockets[i].deliver({ kind: 'commit' });
    await settle();
    expect(sockets[i].closed).toBe(true);
    nextSocket(sockets);
  }
  await sub.stop();
});

test('a clean-up that fails stops neither the skip nor the stream', async () => {
  const handled: number[] = [];
  const { sub, sockets } = subscription(async (e) => {
    if (e.time_us === 10_000_000) throw new Error('cannot be stored');
    handled.push(e.time_us!);
  }, { onSkip: async () => { throw new Error('nor cleared up'); } });
  await sub.start();
  for (const i of [0, 1]) {
    sockets[i].deliver(msg(10_000_000));
    await settle();
    nextSocket(sockets);
  }
  sockets[2].deliver(msg(10_000_000));
  sockets[2].deliver(msg(11_000_000));
  await sub.stop();
  expect(handled).toEqual([11_000_000]);
});

test('the queue outlives a fault in the subscription itself', async () => {
  const handled: number[] = [];
  let failing = true;
  const { sub, sockets } = subscription(async (e) => {
    if (failing) throw new Error('database down');
    handled.push(e.time_us!);
  });
  await sub.start();
  // Stands in for any bug in how a failure is dealt with: here, the log call throws.
  (console.error as jest.Mock).mockImplementationOnce(() => { throw new Error('a bug'); });
  sockets[0].deliver(msg(10_000_000));
  await settle();
  expect(sockets[0].closed).toBe(true);
  failing = false;
  nextSocket(sockets).deliver(msg(10_000_000));
  // Every later event is queued behind the one that went wrong.
  await sub.stop();
  expect(handled).toEqual([10_000_000]);
});

test('a message that is JSON but not an event is dropped', async () => {
  const handled: number[] = [];
  const { sub, sockets } = subscription(async (e) => { handled.push(e.time_us!); });
  await sub.start();
  for (const text of ['null', '42', '"event"']) sockets[0].emit('message', Buffer.from(text));
  sockets[0].deliver(msg(10_000_000));
  await sub.stop();
  expect(sockets[0].terminated).toBe(false);
  expect(handled).toEqual([10_000_000]);
});

test('after twenty skips in an hour the next such event is not skipped, and the subscription reports itself stalled', async () => {
  const { sub, sockets, saved } = subscription(async () => { throw new Error('cannot be stored'); });
  await sub.start();
  /** Deliver an event to one socket after another until it is skipped, or `tries` sockets have been dropped for it. */
  const skippedWithin = async (tries: number, timeUs: number) => {
    for (let i = 0; i < tries; i++) {
      const socket = sockets.at(-1)!;
      socket.deliver(msg(timeUs));
      await settle();
      if (!socket.closed) return true;
      nextSocket(sockets);
    }
    return false;
  };
  for (let n = 1; n <= 20; n++) {
    expect(sub.stalled()).toBe(false);
    expect(await skippedWithin(3, n * 1_000_000)).toBe(true);
  }
  // The allowance is spent. That is reported at once, though the cursor has only just moved.
  expect(sub.stalled()).toBe(true);
  expect(await skippedWithin(6, 21_000_000)).toBe(false);

  // An hour on, such an event is the exception again.
  jest.advanceTimersByTime(60 * 60_000);
  if (sockets.at(-1)!.closed) nextSocket(sockets);
  expect(await skippedWithin(1, 21_000_000)).toBe(true);
  await sub.stop();
  expect(saved.at(-1)).toBe(21_000_000);
});

test('a reconnect is prompt only after a socket that worked: ones that open and get nowhere are retried ever more slowly', async () => {
  let failing = true;
  const { sub, sockets, database } = subscription(async () => { if (failing) throw new Error('database down'); });
  database.writes = false;
  await sub.start();
  /** The socket ends; the next is opened `delay` ms later, and no sooner. */
  const reconnectsAfter = (delay: number) => {
    const before = sockets.length;
    jest.advanceTimersByTime(delay - 1);
    expect(sockets).toHaveLength(before);
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1);
  };
  // Each socket opens, delivers an event that fails, and is dropped. From
  // 2026-11-22 that happened 83,615 times in 36 hours, a second and a half apart.
  for (const [i, delay] of [1_000, 2_000, 4_000].entries()) {
    sockets[i].emit('open');
    sockets[i].deliver(msg(10_000_000));
    await settle();
    reconnectsAfter(delay);
  }

  // Staying open isn't working: a query that hangs holds a socket for half a minute and gets nowhere.
  sockets[3].emit('open');
  jest.advanceTimersByTime(30_000);
  sockets[3].emit('close', 1006);
  reconnectsAfter(8_000);

  // Nor is one event got through on a socket that then goes.
  failing = false;
  sockets[4].emit('open');
  sockets[4].deliver(msg(10_000_000));
  await settle();
  jest.advanceTimersByTime(29_999);
  sockets[4].emit('close', 1006);
  reconnectsAfter(16_000);

  // Half a minute open with the cursor moving is: the reconnect is prompt again.
  sockets[5].emit('open');
  sockets[5].deliver(msg(11_000_000));
  await settle();
  jest.advanceTimersByTime(30_000);
  sockets[5].emit('close', 1006);
  reconnectsAfter(1_000);

  // That says nothing for the sockets after it. One that never opens is waited on longer again.
  sockets[6].emit('close', 1006);
  reconnectsAfter(2_000);
  await sub.stop();
});

test('a NUL in a message, which Postgres cannot store, is dropped before the handler sees it', async () => {
  const records: unknown[] = [];
  const { sub, sockets } = subscription(async (e) => { records.push(e.commit?.record); });
  await sub.start();
  sockets[0].deliver({ kind: 'commit', time_us: 1, commit: { record: { text: 'a\u0000 clip', tags: ['#do\u0000gs'] } } });
  await sub.stop();
  expect(records).toEqual([{ text: 'a clip', tags: ['#dogs'] }]);
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
  const { sub, sockets } = subscription(undefined, { collections: ['a.b.c', 'd.e.f'] });
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
  // Not record keys, though made of a key's characters. Bluesky's AppView refuses a request that names one.
  for (const rkey of ['.', '..']) expect(parseCommit(ev({ operation: 'create', cid: 'c', rkey }), NSID)).toBeNull();
  expect(parseCommit(ev({ operation: 'create', cid: 'c', rkey: '...' }), NSID)).not.toBeNull();
  expect(parseCommit(ev({ operation: 'create' }), NSID)).toBeNull();
  expect(parseCommit(ev({ operation: 'resync' }), NSID)).toBeNull();
  expect(parseCommit({ did: DID, kind: 'identity' }, NSID)).toBeNull();
});
