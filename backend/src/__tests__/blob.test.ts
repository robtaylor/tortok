// Tests for the blob route and the CID it checks bytes against. The PDS is
// stubbed; the CID test vector is real: test-content/posters/bbb-05.jpg as
// uploaded to tortok-dev's PDS (checked 2026-11-11).

import fs from 'fs';
import path from 'path';
import { blobCid, isCid } from '../atproto/cid';
import { createBlobRouter, IMMUTABLE } from '../routes/blob';
import { startServer, TestServer } from './helpers/testServer';

const POSTER = fs.readFileSync(path.join(__dirname, '../../../test-content/posters/bbb-05.jpg'));
const POSTER_CID = 'bafkreiesysokdzugsbalswd53dymlq5hjaddr265np7fnahj44beei3q7i';
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const PDS = 'https://pds.example.com';

describe('blobCid', () => {
  it('matches the CID a PDS gave a real upload', () => {
    expect(blobCid(POSTER)).toBe(POSTER_CID);
    expect(isCid(POSTER_CID)).toBe(true);
  });

  it('rejects things that are not CIDs', () => {
    expect(isCid('../../etc/passwd')).toBe(false);
    expect(isCid('Bafkrei')).toBe(false);
  });
});

describe('GET /blob/:did/:cid', () => {
  let server: TestServer;
  let base: string;
  let upstream: { status: number; body: Uint8Array; type: string };
  const requested: string[] = [];

  beforeAll(() => {
    server = startServer('/blob', createBlobRouter({
      pdsFor: async (did) => (did === ALICE ? PDS : null),
      fetch: (async (url: string) => {
        requested.push(String(url));
        return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.type } });
      }) as typeof fetch,
      maxBytes: 100_000,
      cacheBytes: 0, // each test sees the PDS
    }));
    base = server.base;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    requested.length = 0;
    upstream = { status: 200, body: POSTER, type: 'image/jpeg' };
  });

  it("serves an indexed author's blob from their PDS, as immutable", async () => {
    const res = await fetch(`${base}/blob/${ALICE}/${POSTER_CID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer()).equals(POSTER)).toBe(true);
    expect(requested).toEqual([`${PDS}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(ALICE)}&cid=${POSTER_CID}`]);
  });

  it('refuses bytes that do not match the CID', async () => {
    upstream.body = Buffer.concat([POSTER, Buffer.from('x')]);
    const res = await fetch(`${base}/blob/${ALICE}/${POSTER_CID}`);
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).not.toBe(IMMUTABLE);
  });

  it('serves anything but images and torrents as sandboxed octet-stream', async () => {
    const html = Buffer.from('<script>alert(1)</script>');
    upstream = { status: 200, body: html, type: 'text/html' };
    const res = await fetch(`${base}/blob/${ALICE}/${blobCid(html)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('404s for an author it has not indexed, without contacting anyone', async () => {
    const res = await fetch(`${base}/blob/did:plc:zzzzzzzzzzzzzzzzzzzzzzzz/${POSTER_CID}`);
    expect(res.status).toBe(404);
    expect(requested).toEqual([]);
  });

  it('400s for a malformed DID or CID', async () => {
    expect((await fetch(`${base}/blob/not-a-did/${POSTER_CID}`)).status).toBe(400);
    expect((await fetch(`${base}/blob/${ALICE}/not-a-cid`)).status).toBe(400);
  });

  it('passes on a missing blob as 404 and other PDS errors as 502', async () => {
    upstream.status = 404;
    expect((await fetch(`${base}/blob/${ALICE}/${POSTER_CID}`)).status).toBe(404);
    upstream.status = 500;
    expect((await fetch(`${base}/blob/${ALICE}/${POSTER_CID}`)).status).toBe(502);
  });

  it('refuses a blob over the size limit, even with no Content-Length', async () => {
    const big = Buffer.alloc(200_000, 1);
    upstream = { status: 200, body: big, type: 'image/jpeg' };
    expect((await fetch(`${base}/blob/${ALICE}/${blobCid(big)}`)).status).toBe(413);
  });

  it('answers a matching If-None-Match with 304, without contacting the PDS', async () => {
    const res = await fetch(`${base}/blob/${ALICE}/${POSTER_CID}`, { headers: { 'If-None-Match': `"${POSTER_CID}"` } });
    expect(res.status).toBe(304);
    expect(requested).toEqual([]);
  });
});

describe('GET /blob/:did/:cid with its cache', () => {
  let server: TestServer;
  let base: string;
  let calls = 0;

  beforeAll(() => {
    server = startServer('/blob', createBlobRouter({
      pdsFor: async () => PDS,
      fetch: (async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(POSTER, { headers: { 'content-type': 'image/jpeg' } });
      }) as typeof fetch,
    }));
    base = server.base;
  });
  afterAll(() => server.close());

  it('fetches a blob once for concurrent and later requests', async () => {
    const url = `${base}/blob/${ALICE}/${POSTER_CID}`;
    const first = await Promise.all([fetch(url), fetch(url), fetch(url)]);
    expect(first.map((r) => r.status)).toEqual([200, 200, 200]);
    const again = await fetch(url);
    expect(Buffer.from(await again.arrayBuffer()).equals(POSTER)).toBe(true);
    expect(again.headers.get('etag')).toBe(`"${POSTER_CID}"`);
    expect(calls).toBe(1);
  });
});
