// A stand-in for Jetstream's WebSocket: tests emit 'message' and 'close' on
// it and check the URL it was opened with.

import { EventEmitter } from 'events';
import type { WebSocketLike } from '../../services/jetstream';

export class FakeSocket extends EventEmitter implements WebSocketLike {
  closed = false;
  constructor(public url: string) { super(); }
  close() { this.closed = true; }
}

/** A wsFactory that records every socket it opens. */
export function fakeSockets(): { sockets: FakeSocket[]; wsFactory: (url: string) => FakeSocket } {
  const sockets: FakeSocket[] = [];
  return { sockets, wsFactory: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; } };
}
