// A Jetstream subscription (Decision 0017): one WebSocket filtered
// server-side to some collections, with reconnect backoff, a saved cursor in
// `ingest_cursor`, and events handed to a callback one at a time, in order.
// Shared by atprotoIngest (app.tortok.video.post) and bskyFirehose
// (app.bsky.feed.post), each with its own socket and cursor key, so the
// bridge's load and failures stay off native ingest.
//
// The cursor is saved every few seconds and on stop, and rewound a little on
// reconnect; handlers must be idempotent, so the replay is harmless. It moves
// only past events that were handled. A handler that throws means the
// infrastructure failed (handlers skip bad records without throwing), so the
// subscription resyncs: it drops the queued events and reconnects, with
// backoff, from the last event handled.
//
// Two things keep it moving when the other end misbehaves:
// - Jetstream replays a cursor far faster than events are handled here, so
//   the socket is paused while events are queued and read again once they
//   drain. If the queue backs up all the same, the subscription resyncs, so
//   a stalled database can't grow it without bound.
// - Jetstream can leave a connection open and send nothing more on it (it
//   did, for 26 hours, on 2026-11-19). A socket that delivers nothing for
//   SILENCE_MS is dropped and the subscription connects again.
//
// A socket the subscription has left can still deliver what it had buffered;
// those events are ignored, or the cursor would move past the ones dropped.

import WebSocket from 'ws';
import { query as defaultQuery } from '../db';
import type { QueryFn } from '../db';
import { isDid } from '../atproto/identity';

/** The subset of the `ws` WebSocket API used here (tests fake it). */
export interface WebSocketLike {
  on(event: 'open', cb: () => void): unknown;
  on(event: 'message', cb: (data: WebSocket.RawData) => void): unknown;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  close(): void;
  /** Drop the connection at once, with no closing handshake. */
  terminate(): void;
  /** Stop reading from the connection, so the sender has to wait. */
  pause(): void;
  resume(): void;
  readonly isPaused: boolean;
}

export interface JetstreamEvent {
  did?: string;
  time_us?: number;
  kind?: string;
  commit?: {
    operation?: string;
    collection?: string;
    rkey?: string;
    cid?: string;
    record?: unknown;
  };
}

export const DEFAULT_JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';
/** A valid record key (atproto record-key syntax). */
export const RKEY_RE = /^[A-Za-z0-9._:~-]{1,512}$/;

/** A commit event for one collection, with its identifiers checked. */
export type Commit = { did: string; rkey: string; uri: string } & (
  | { operation: 'delete' }
  | { operation: 'create' | 'update'; cid: string; record: unknown });

/**
 * The event as a commit to `collection`, or null if it isn't one or its DID,
 * rkey, operation or CID is malformed.
 */
export function parseCommit(event: JetstreamEvent, collection: string): Commit | null {
  const { did, commit } = event;
  if (event.kind !== 'commit' || !did || !commit || commit.collection !== collection) return null;
  const { operation, rkey, cid, record } = commit;
  if (!rkey || !RKEY_RE.test(rkey) || !isDid(did)) return null;
  const ids = { did, rkey, uri: `at://${did}/${collection}/${rkey}` };
  if (operation === 'delete') return { ...ids, operation };
  if ((operation !== 'create' && operation !== 'update') || !cid) return null;
  return { ...ids, operation, cid, record };
}

/** Rewind on reconnect, in Jetstream's microseconds. */
const CURSOR_REWIND_US = 5_000_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/**
 * Queued events at which the socket is paused, and at which it is read again.
 * A paused socket isn't read at all, and a server may drop a reader that
 * stops for long, so it is read again well before the queue is empty.
 */
const PAUSE_AT = 1_000;
const RESUME_AT = 500;
/** Queued events past which the subscription resyncs instead of buffering more. */
const MAX_QUEUED = 5_000;
/** A socket that delivers nothing for this long is dropped. Jetstream's streams are never this quiet. */
const SILENCE_MS = 60_000;
/** With the cursor unmoved for this long, the subscription reports itself stalled. */
const STALLED_MS = 5 * 60_000;

export interface JetstreamOptions {
  /** Prefix for log lines, e.g. 'ingest'. */
  tag: string;
  collections: string[];
  /** The `ingest_cursor` row this subscription resumes from. */
  cursorKey: string;
  onEvent: (event: JetstreamEvent) => Promise<void>;
  db?: QueryFn;
  wsFactory?: (url: string) => WebSocketLike;
  /** Jetstream subscribe endpoint, without query string. */
  url?: string;
  cursorFlushMs?: number;
}

export class JetstreamSubscription {
  private readonly opts: Required<JetstreamOptions>;
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private flushTimer: NodeJS.Timeout | null = null;
  private cursor: number | null = null;
  private savedCursor: number | null = null;
  /** Events are handled one at a time, in order, so the cursor only moves forward. */
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  /** Bumped by resync(); events queued under an older generation are dropped. */
  private generation = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  /** Whether the socket has delivered anything since the last silence check. */
  private heard = false;
  /** When the cursor last moved. Replayed events don't count: a socket can deliver its rewind and nothing else. */
  private lastProgressAt = Date.now();

  constructor(opts: JetstreamOptions) {
    if (opts.collections.length === 0) throw new Error(`[${opts.tag}] no collections to subscribe to`);
    // Defaults per field: callers pass their own options through, and the
    // spread alone would keep an explicit undefined.
    this.opts = {
      ...opts,
      db: opts.db ?? defaultQuery,
      wsFactory: opts.wsFactory ?? ((url) => new WebSocket(url)),
      url: opts.url ?? DEFAULT_JETSTREAM_URL,
      cursorFlushMs: opts.cursorFlushMs ?? 5_000,
    };
  }

  /** Load the saved cursor and connect. */
  async start(): Promise<void> {
    this.stopped = false;
    const [row] = await this.opts.db<{ cursor: string | null }>(
      'SELECT cursor FROM ingest_cursor WHERE key = $1', [this.opts.cursorKey]);
    this.cursor = row?.cursor != null ? Number(row.cursor) : null;
    this.savedCursor = this.cursor;
    this.lastProgressAt = Date.now();
    this.connect();
    this.flushTimer = setInterval(() => void this.flushCursor(), this.opts.cursorFlushMs);
    this.silenceTimer = setInterval(() => this.checkSilence(), SILENCE_MS);
    console.log(`[${this.opts.tag}] subscribing from cursor ${this.cursor ?? 'now'}`);
  }

  /** Disconnect, finish queued events and save the cursor. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.reconnectTimer = this.flushTimer = this.silenceTimer = null;
    this.ws?.close();
    this.ws = null;
    await this.queue;
    await this.flushCursor();
  }

  /** Whether the cursor hasn't moved for STALLED_MS: the stream, or what handles it, is stuck. */
  stalled(): boolean {
    return Date.now() - this.lastProgressAt > STALLED_MS;
  }

  private subscribeUrl(): string {
    const url = new URL(this.opts.url);
    for (const c of this.opts.collections) url.searchParams.append('wantedCollections', c);
    if (this.cursor !== null) {
      url.searchParams.set('cursor', String(Math.max(0, this.cursor - CURSOR_REWIND_US)));
    }
    return url.toString();
  }

  private connect(): void {
    if (this.stopped) return;
    const { tag } = this.opts;
    let ws: WebSocketLike;
    try {
      ws = this.opts.wsFactory(this.subscribeUrl());
    } catch (err) {
      console.error(`[${tag}] Jetstream connect failed:`, err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    // A new socket gets a full interval to deliver something.
    this.heard = true;
    ws.on('open', () => {
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      console.log(`[${tag}] Jetstream connected`);
    });
    ws.on('message', (data) => {
      if (this.ws !== ws) return;
      this.heard = true;
      let event: JetstreamEvent;
      try {
        event = JSON.parse(data.toString());
      } catch {
        console.warn(`[${tag}] dropped a non-JSON Jetstream message`);
        return;
      }
      this.enqueue(ws, event);
    });
    ws.on('error', (err) => {
      if (this.ws === ws) console.error(`[${tag}] Jetstream error:`, err.message);
    });
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.stopped) console.warn(`[${tag}] Jetstream closed (${code})`);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Queue an event from the current socket. */
  private enqueue(ws: WebSocketLike, event: JetstreamEvent): void {
    if (this.queued >= MAX_QUEUED) {
      this.resync(`${MAX_QUEUED} events queued`);
      return;
    }
    const generation = this.generation;
    this.queued++;
    if (this.queued >= PAUSE_AT && !ws.isPaused) ws.pause();
    this.queue = this.queue.then(async () => {
      this.queued--;
      if (this.queued <= RESUME_AT && this.ws?.isPaused) this.ws.resume();
      if (generation !== this.generation) return;
      try {
        await this.opts.onEvent(event);
      } catch (err) {
        console.error(`[${this.opts.tag}] event failed:`, err);
        this.resync('an event failed');
        return;
      }
      if (typeof event.time_us === 'number' && (this.cursor === null || event.time_us > this.cursor)) {
        this.cursor = event.time_us;
        this.lastProgressAt = Date.now();
      }
    });
  }

  /** Drop a socket that has delivered nothing since the last check. */
  private checkSilence(): void {
    if (this.stalled()) {
      const minutes = Math.round((Date.now() - this.lastProgressAt) / 60_000);
      console.error(`[${this.opts.tag}] stalled: the cursor hasn't moved for ${minutes} min (${this.queued} queued)`);
    }
    // Between sockets the reconnect timer is running. A paused socket is quiet
    // by our doing, and keeps `heard` from the message that paused it.
    if (!this.ws || this.ws.isPaused) return;
    if (!this.heard) this.resync(`nothing received for ${SILENCE_MS / 1000} s`);
    this.heard = false;
  }

  /** Drop queued events and reconnect, with backoff, from the last event handled. */
  private resync(reason: string): void {
    this.generation++;
    const ws = this.ws;
    if (!ws) return; // already reconnecting
    console.warn(`[${this.opts.tag}] resyncing from cursor ${this.cursor ?? 'now'}: ${reason}`);
    this.ws = null;
    // Not close(): its handshake waits on a peer that may be dead or mid-flood.
    ws.terminate();
    this.scheduleReconnect();
  }

  private async flushCursor(): Promise<void> {
    if (this.cursor === null || this.cursor === this.savedCursor) return;
    const cursor = this.cursor;
    try {
      await this.opts.db(
        `INSERT INTO ingest_cursor (key, cursor, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
        [this.opts.cursorKey, cursor]);
      this.savedCursor = cursor;
    } catch (err) {
      console.error(`[${this.opts.tag}] saving the cursor failed:`, err);
    }
  }
}
