// GET /blob/:did/:cid — a blob from an indexed author's PDS: posters,
// avatars and .torrent files (Phase 3 Unit 2.5B).
//
// The bytes are fetched from the author's PDS (com.atproto.sync.getBlob),
// checked against the CID, and returned with a year-long immutable
// Cache-Control and the CID as ETag, so Cloudflare and clients cache them
// for good: a CID names its content, so a cached copy can't go stale. Until
// a CDN sits in front of this origin, an in-process cache (bounded by bytes)
// keeps repeat requests off the author's PDS, and concurrent misses share
// one fetch.
//
// Only authors in `profiles` are served, from the PDS their DID document
// names, so the route can't be used to fetch arbitrary URLs. The PDS's
// content type is passed through only for images and .torrent files;
// anything else goes out as application/octet-stream, sandboxed, so a
// hostile PDS can't serve a page on this origin.

import { Router, type Request, type Response } from 'express';
import { blobCid, isCid } from '../atproto/cid';
import { isDid } from '../atproto/identity';
import type { FetchFn } from '../atproto/identity';
import { query } from '../db';

export interface BlobRouteDeps {
  /** The author's PDS endpoint, or null if the DID isn't indexed (default: `profiles`). */
  pdsFor?: (did: string) => Promise<string | null>;
  fetch?: FetchFn;
  /** Largest blob served, in bytes (default 5 MB: posters, avatars, .torrent files). */
  maxBytes?: number;
  /** In-process cache size, in bytes (default 64 MB; 0 turns it off). */
  cacheBytes?: number;
  timeoutMs?: number;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';

const SAFE_TYPES = /^(image\/(jpeg|png|webp|gif|avif)|application\/x-bittorrent)$/;

function safeContentType(upstream: string | null): string {
  const type = (upstream ?? '').split(';')[0].trim().toLowerCase();
  return SAFE_TYPES.test(type) ? type : 'application/octet-stream';
}

async function pdsFromProfiles(did: string): Promise<string | null> {
  const [row] = await query<{ pds_endpoint: string | null }>(
    'SELECT pds_endpoint FROM profiles WHERE did = $1', [did]);
  return row?.pds_endpoint ?? null;
}

interface Blob {
  bytes: Buffer;
  type: string;
}

/** A failure with the status the client should see. */
class BlobError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Reads a response body, failing as soon as it passes `maxBytes`. */
async function readCapped(res: globalThis.Response, maxBytes: number): Promise<Buffer> {
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new BlobError(413, 'Blob too large');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BlobError(413, 'Blob too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** Least-recently-used cache bounded by total bytes. */
class ByteLru {
  private readonly entries = new Map<string, Blob>();
  private size = 0;
  constructor(private readonly capacity: number) {}

  get(key: string): Blob | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, blob: Blob): void {
    if (blob.bytes.length > this.capacity) return;
    this.entries.set(key, blob);
    this.size += blob.bytes.length;
    for (const [k, v] of this.entries) {
      if (this.size <= this.capacity) break;
      this.entries.delete(k);
      this.size -= v.bytes.length;
    }
  }
}

export function createBlobRouter(deps: BlobRouteDeps = {}): Router {
  const pdsFor = deps.pdsFor ?? pdsFromProfiles;
  const doFetch = deps.fetch ?? fetch;
  const maxBytes = deps.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const cache = new ByteLru(deps.cacheBytes ?? 64 * 1024 * 1024);
  const inflight = new Map<string, Promise<Blob>>();

  async function load(did: string, cid: string): Promise<Blob> {
    const pds = await pdsFor(did);
    if (!pds) throw new BlobError(404, 'Unknown author');
    const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
    let upstream: globalThis.Response;
    try {
      upstream = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new BlobError(504, err instanceof Error && err.name === 'TimeoutError' ? 'PDS timed out' : 'PDS unreachable');
    }
    if (upstream.status === 400 || upstream.status === 404) throw new BlobError(404, 'Blob not found');
    if (!upstream.ok) throw new BlobError(502, `PDS returned HTTP ${upstream.status}`);
    const bytes = await readCapped(upstream, maxBytes);
    if (blobCid(bytes) !== cid) throw new BlobError(502, "PDS returned bytes that don't match the CID");
    return { bytes, type: safeContentType(upstream.headers.get('content-type')) };
  }

  /** Cached, and shared between concurrent requests for the same blob. */
  function get(did: string, cid: string): Promise<Blob> {
    const key = `${did}/${cid}`;
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    let pending = inflight.get(key);
    if (!pending) {
      pending = load(did, cid)
        .then((blob) => {
          cache.set(key, blob);
          return blob;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  }

  const router = Router();
  router.get('/:did/:cid', async (req: Request, res: Response) => {
    const { did, cid } = req.params;
    if (!isDid(did) || !isCid(cid)) {
      res.status(400).json({ error: 'Not a DID and blob CID' });
      return;
    }
    const etag = `"${cid}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).set({ ETag: etag, 'Cache-Control': IMMUTABLE }).end();
      return;
    }
    try {
      const blob = await get(did, cid);
      res.set({
        'Content-Type': blob.type,
        'Cache-Control': IMMUTABLE,
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.send(blob.bytes);
    } catch (err) {
      if (err instanceof BlobError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error('Blob route error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  return router;
}
