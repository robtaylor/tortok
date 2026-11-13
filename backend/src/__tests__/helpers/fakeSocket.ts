// A stand-in for Jetstream's WebSocket: tests deliver events and emit 'close'
// on it, and check the URL it was opened with.

import { EventEmitter } from 'events';
import type { JetstreamEvent, WebSocketLike } from '../../services/jetstream';

export class FakeSocket extends EventEmitter implements WebSocketLike {
  closed = false;
  constructor(public url: string) { super(); }
  close() { this.closed = true; }
  /** Deliver an event as Jetstream does, as one JSON message. */
  deliver(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
}

/** A wsFactory that records every socket it opens. */
export function fakeSockets(): { sockets: FakeSocket[]; wsFactory: (url: string) => FakeSocket } {
  const sockets: FakeSocket[] = [];
  return { sockets, wsFactory: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; } };
}

/** A commit event as Jetstream delivers it. */
export function commitEvent(
  collection: string, did: string, rkey: string, operation: string,
  record?: unknown, cid = 'bafyrecord1', time_us = 1_000,
): JetstreamEvent {
  return { did, time_us, kind: 'commit', commit: { operation, collection, rkey, cid, record } };
}
