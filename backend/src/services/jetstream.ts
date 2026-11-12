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
// backoff, from the last event handled. It does the same if the queue backs
// up, so a stalled database can't grow it without bound.

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
/** Queued events past which the subscription resyncs instead of buffering more. */
const MAX_QUEUED = 5_000;

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
    this.connect();
    this.flushTimer = setInterval(() => void this.flushCursor(), this.opts.cursorFlushMs);
    console.log(`[${this.opts.tag}] subscribing from cursor ${this.cursor ?? 'now'}`);
  }

  /** Disconnect, finish queued events and save the cursor. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.reconnectTimer = this.flushTimer = null;
    this.ws?.close();
    this.ws = null;
    await this.queue;
    await this.flushCursor();
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
    ws.on('open', () => {
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      console.log(`[${tag}] Jetstream connected`);
    });
    ws.on('message', (data) => {
      let event: JetstreamEvent;
      try {
        event = JSON.parse(data.toString());
      } catch {
        console.warn(`[${tag}] dropped a non-JSON Jetstream message`);
        return;
      }
      this.enqueue(event);
    });
    ws.on('error', (err) => console.error(`[${tag}] Jetstream error:`, err.message));
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

  private enqueue(event: JetstreamEvent): void {
    if (this.queued >= MAX_QUEUED) {
      this.resync(`${MAX_QUEUED} events queued`);
      return;
    }
    const generation = this.generation;
    this.queued++;
    this.queue = this.queue.then(async () => {
      this.queued--;
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
      }
    });
  }

  /** Drop queued events and reconnect, with backoff, from the last event handled. */
  private resync(reason: string): void {
    this.generation++;
    const ws = this.ws;
    if (!ws) return; // already reconnecting
    console.warn(`[${this.opts.tag}] resyncing from cursor ${this.cursor ?? 'now'}: ${reason}`);
    this.ws = null;
    ws.close();
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
