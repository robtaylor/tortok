// Unit tests for the Phase 3 Unit 2.5 final-slice feed handler
// (UNION of native `videos` rows + mirrored `bridged_posts` rows).
// Drives the route handler directly with mocked Express req/res +
// mocked `query` helper so postgres isn't required to run the suite.
//
// Coverage:
//   - mixed result (1 native + 1 bridged) — both surface, ordered
//     by created_at DESC, with correct `source` discriminator and
//     `bsky` sub-object on the bridged item.
//   - bridged-only — every item carries `source: 'bsky'` plus
//     `bsky.atUri` + `bsky.handle`.
//   - native-only — every item carries `source: 'tortok'` and NO
//     `bsky` field.
//   - the `last_played_at` touch UPDATE fires when (and only when)
//     bridged items are present.
//   - pagination respects offset/limit across the UNION (the SQL
//     param binding actually receives the values).

import express, { type Express } from 'express';

// Hoisted module mocks. The route module imports `query` and
// `getClient` from '../db'; we replace those before the route is
// loaded so the handler's `query()` call goes through `mockQuery`.
const mockQuery = jest.fn();
const mockGetClient = jest.fn();

jest.mock('../../db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  getClient: () => mockGetClient(),
}));

// Auth middleware imports JWT_SECRET at module-eval time and throws
// if missing. Set a value before the route module loads.
process.env.JWT_SECRET = 'test-secret-feed-test';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const videosRouter = require('../videos').default;

// ─── Fixtures ────────────────────────────────────────────────────

const NATIVE_TIME = new Date('2026-05-01T11:00:00Z');
const BSKY_TIME = new Date('2026-05-01T12:00:00Z'); // newer

const NATIVE_ROW = {
  source: 'tortok',
  id: '11111111-1111-1111-1111-111111111111',
  caption: 'native caption',
  magnet_link: 'magnet:?xt=urn:btih:NATIVE',
  torrent_file_url: 'https://r2.example/native.torrent',
  poster_url: 'https://r2.example/native.jpg',
  duration_seconds: 12,
  width: 720,
  height: 1280,
  like_count: 5,
  created_at: NATIVE_TIME,
  user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  username: 'nativeuser',
  display_name: 'Native User',
  avatar_url: 'https://r2.example/avatar.png',
  hashtags: ['cats', 'fyp'],
  is_liked: false,
  bsky_at_uri: null,
  bsky_handle: null,
};

const BRIDGED_ROW = {
  source: 'bsky',
  id: 'at://did:plc:abc/app.bsky.feed.post/3kabc',
  caption: 'bridged caption',
  magnet_link: 'magnet:?xt=urn:btih:BRIDGED',
  torrent_file_url: 'https://r2.example/bridged.torrent',
  poster_url: 'https://r2.example/bridged.jpg',
  duration_seconds: 30,
  width: 720,
  height: 1280,
  like_count: 50,
  created_at: BSKY_TIME,
  user_id: 'did:plc:abc',
  username: 'someone.bsky.social',
  display_name: 'Some One',
  avatar_url: 'https://cdn.bsky.app/avatar/abc.jpg',
  hashtags: [],
  is_liked: false,
  bsky_at_uri: 'at://did:plc:abc/app.bsky.feed.post/3kabc',
  bsky_handle: 'someone.bsky.social',
};

// ─── Helpers ─────────────────────────────────────────────────────

interface CapturedResponse {
  status: number;
  body: any;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/videos', videosRouter);
  return app;
}

// Direct handler invocation via a tiny in-process express request,
// avoiding a supertest dep. Builds a minimal AuthRequest and a Response
// stub that captures status + json. Uses the actual router so the
// optionalAuth middleware runs, but no JWT is supplied so userId is
// undefined.
async function callFeed(opts: { limit?: number; offset?: number } = {}): Promise<CapturedResponse> {
  const { limit, offset } = opts;
  const app = buildApp();
  // Construct the URL with query params.
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const url = `/videos/feed${params.toString() ? `?${params}` : ''}`;

  // Use Node's http to drive the express app — no extra deps.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http');
  return await new Promise<CapturedResponse>((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        { host: '127.0.0.1', port, path: url, method: 'GET' },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            server.close();
            resolve({ status: res.statusCode, body });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /videos/feed — UNION of native + bridged', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetClient.mockReset();
  });

  test('mixed result: 1 native + 1 bridged → both surface, ordered by created_at DESC', async () => {
    // Postgres ORDER BY DESC: bridged (newer) first, native (older) second.
    mockQuery.mockImplementationOnce(async () => [BRIDGED_ROW, NATIVE_ROW]);
    // Second call: the last_played_at touch UPDATE.
    mockQuery.mockImplementationOnce(async () => []);

    const res = await callFeed();
    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(2);

    const [first, second] = res.body.videos;
    // Bridged is newer, comes first.
    expect(first.source).toBe('bsky');
    expect(first.id).toBe('at://did:plc:abc/app.bsky.feed.post/3kabc');
    expect(first.bsky).toEqual({
      atUri: 'at://did:plc:abc/app.bsky.feed.post/3kabc',
      handle: 'someone.bsky.social',
    });
    expect(first.user).toEqual({
      id: 'did:plc:abc',
      username: 'someone.bsky.social',
      displayName: 'Some One',
      avatarURL: 'https://cdn.bsky.app/avatar/abc.jpg',
    });
    expect(first.magnetLink).toBe('magnet:?xt=urn:btih:BRIDGED');
    expect(first.hashtags).toEqual([]);
    expect(first.isLiked).toBe(false);

    expect(second.source).toBe('tortok');
    expect(second.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(second.bsky).toBeUndefined();
    expect(second.user.username).toBe('nativeuser');
    expect(second.hashtags).toEqual(['cats', 'fyp']);
  });

  test('bridged-only: every item carries source=bsky + bsky.{atUri,handle}', async () => {
    const second = {
      ...BRIDGED_ROW,
      id: 'at://did:plc:def/app.bsky.feed.post/3kdef',
      bsky_at_uri: 'at://did:plc:def/app.bsky.feed.post/3kdef',
      user_id: 'did:plc:def',
      username: 'other.bsky.social',
      bsky_handle: 'other.bsky.social',
      created_at: new Date('2026-05-01T10:00:00Z'),
    };
    mockQuery.mockImplementationOnce(async () => [BRIDGED_ROW, second]);
    mockQuery.mockImplementationOnce(async () => []); // touch UPDATE

    const res = await callFeed();
    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(2);
    for (const v of res.body.videos) {
      expect(v.source).toBe('bsky');
      expect(v.bsky).toBeDefined();
      expect(typeof v.bsky.atUri).toBe('string');
      expect(typeof v.bsky.handle).toBe('string');
    }
  });

  test('native-only: every item carries source=tortok and NO bsky field', async () => {
    mockQuery.mockImplementationOnce(async () => [NATIVE_ROW]);
    // No second call expected for the touch UPDATE — no bridged rows.

    const res = await callFeed();
    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(1);
    const [item] = res.body.videos;
    expect(item.source).toBe('tortok');
    expect(item.bsky).toBeUndefined();

    // Only the SELECT was issued — NO touch UPDATE because no bridged
    // rows were returned.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('last_played_at touch UPDATE fires when bridged items are present', async () => {
    mockQuery.mockImplementationOnce(async () => [BRIDGED_ROW]);
    mockQuery.mockImplementationOnce(async () => []);

    const res = await callFeed();
    expect(res.status).toBe(200);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [secondCallSql, secondCallParams] = mockQuery.mock.calls[1]!;
    expect(secondCallSql).toMatch(/UPDATE\s+bridged_posts/i);
    expect(secondCallSql).toMatch(/last_played_at\s*=\s*NOW\(\)/i);
    expect(secondCallSql).toMatch(/bsky_at_uri\s*=\s*ANY/i);
    expect(secondCallParams).toEqual([['at://did:plc:abc/app.bsky.feed.post/3kabc']]);
  });

  test('last_played_at touch UPDATE does NOT fire when only native items are returned', async () => {
    mockQuery.mockImplementationOnce(async () => [NATIVE_ROW]);

    const res = await callFeed();
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const [, params] = mockQuery.mock.calls[0]!;
    // Sanity: this was the SELECT, not an UPDATE.
    const [sql] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/SELECT/i);
    expect(sql).not.toMatch(/UPDATE\s+bridged_posts/i);
    expect(Array.isArray(params)).toBe(true);
  });

  test('pagination: offset/limit are passed through as $1/$2 SQL params', async () => {
    mockQuery.mockImplementationOnce(async () => []);

    const res = await callFeed({ limit: 5, offset: 30 });
    expect(res.status).toBe(200);

    const [, params] = mockQuery.mock.calls[0]!;
    // Unauthenticated → only [limit, offset].
    expect(params).toEqual([5, 30]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  test('pagination: hasMore=true + nextCursor advances when batch fills', async () => {
    // 5 rows, all native (no touch UPDATE expected).
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ...NATIVE_ROW,
      id: `00000000-0000-0000-0000-00000000000${i}`,
    }));
    mockQuery.mockImplementationOnce(async () => rows);

    const res = await callFeed({ limit: 5, offset: 10 });
    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(5);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBe('15');
  });
});
