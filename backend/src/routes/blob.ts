// GET /blob/:did/:cid — a blob from an indexed author's PDS: posters,
// avatars and .torrent files (Phase 3 Unit 2.5B).
//
// The bytes are fetched from the author's PDS (com.atproto.sync.getBlob),
// checked against the CID, and returned with a year-long immutable
// Cache-Control, so Cloudflare (and clients) cache them for good: a CID
// names its content, so a cached copy can't go stale.
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

export interface BlobRouteDeps {
  /** The author's PDS endpoint, or null if the DID isn't indexed. */
  pdsFor: (did: string) => Promise<string | null>;
  fetch?: FetchFn;
  /** Largest blob served, in bytes (default 5 MB: posters, avatars, .torrent files). */
  maxBytes?: number;
  timeoutMs?: number;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';

const SAFE_TYPES = /^(image\/(jpeg|png|webp|gif|avif)|application\/x-bittorrent)$/;

function safeContentType(upstream: string | null): string {
  const type = (upstream ?? '').split(';')[0].trim().toLowerCase();
  return SAFE_TYPES.test(type) ? type : 'application/octet-stream';
}

export function createBlobRouter(deps: BlobRouteDeps): Router {
  const doFetch = deps.fetch ?? fetch;
  const maxBytes = deps.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const router = Router();

  router.get('/:did/:cid', async (req: Request, res: Response) => {
    const { did, cid } = req.params;
    if (!isDid(did) || !isCid(cid)) {
      res.status(400).json({ error: 'Not a DID and blob CID' });
      return;
    }
    try {
      const pds = await deps.pdsFor(did);
      if (!pds) {
        res.status(404).json({ error: 'Unknown author' });
        return;
      }
      const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
      const upstream = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (upstream.status === 400 || upstream.status === 404) {
        res.status(404).json({ error: 'Blob not found' });
        return;
      }
      if (!upstream.ok) {
        res.status(502).json({ error: `PDS returned HTTP ${upstream.status}` });
        return;
      }
      const declared = Number(upstream.headers.get('content-length') ?? 0);
      if (declared > maxBytes) {
        res.status(413).json({ error: 'Blob too large' });
        return;
      }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (bytes.length > maxBytes) {
        res.status(413).json({ error: 'Blob too large' });
        return;
      }
      if (blobCid(bytes) !== cid) {
        res.status(502).json({ error: "PDS returned bytes that don't match the CID" });
        return;
      }
      res.set({
        'Content-Type': safeContentType(upstream.headers.get('content-type')),
        'Cache-Control': IMMUTABLE,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.send(Buffer.from(bytes));
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'PDS timed out' : 'PDS unreachable';
      res.status(504).json({ error: reason });
    }
  });

  return router;
}
