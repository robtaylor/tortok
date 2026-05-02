// Unit tests for the Phase 3 Unit 2.5 engagement poller (slice 2).
// Drives `runOnce()` directly with mocked fetch + query helpers so
// neither postgres nor `public.api.bsky.app` is required.
import { BskyEngagementPoller } from '../bskyEngagementPoller';

// ─── Helpers ─────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: any[] | undefined;
}

interface PendingRow {
  id: string;
  bsky_at_uri: string;
  bsky_did: string;
  bsky_handle: string | null;
  author_followers_count: number | null;
  indexed_at: Date;
}

const NOW = new Date('2026-05-01T12:00:00Z');
const RECENT = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
const OLD = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

function makeRow(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: 'row-1',
    bsky_at_uri: 'at://did:plc:abc/app.bsky.feed.post/3kabc',
    bsky_did: 'did:plc:abc',
    bsky_handle: null,
    author_followers_count: null,
    indexed_at: RECENT,
    ...overrides,
  };
}

interface MockEnv {
  rows: PendingRow[];
  postsResponse?: { posts: any[] };
  profilesResponse?: { profiles: any[] };
  getPostsStatus?: number;
  getProfilesStatus?: number;
  fetchError?: Error;
}

function makeMockDb(rows: PendingRow[]) {
  const calls: QueryCall[] = [];
  const mockDb = jest.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql) && /FROM\s+bridged_posts/i.test(sql)) {
      return rows;
    }
    return [];
  });
  return { mockDb, calls };
}

function makeFetch(env: MockEnv) {
  return jest.fn(async (input: string | URL) => {
    const url = String(input);
    if (env.fetchError) throw env.fetchError;
    if (url.includes('app.bsky.feed.getPosts')) {
      const status = env.getPostsStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => env.postsResponse ?? { posts: [] },
      } as Response;
    }
    if (url.includes('app.bsky.actor.getProfiles')) {
      const status = env.getProfilesStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => env.profilesResponse ?? { profiles: [] },
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function makeService(env: MockEnv): {
  svc: BskyEngagementPoller;
  calls: QueryCall[];
  mockFetch: jest.Mock;
} {
  const { mockDb, calls } = makeMockDb(env.rows);
  const mockFetch = makeFetch(env);
  const svc = new BskyEngagementPoller(mockDb as any, mockFetch as any, () => NOW);
  return { svc, calls, mockFetch };
}

// Build a posts[] response shape mirroring app.bsky.feed.getPosts.
function postFromRow(
  row: PendingRow,
  engagement: { likeCount: number; repostCount: number; replyCount: number },
  author: { handle: string; displayName: string; avatar: string }
): any {
  return {
    uri: row.bsky_at_uri,
    cid: 'cid-1',
    author: {
      did: row.bsky_did,
      handle: author.handle,
      displayName: author.displayName,
      avatar: author.avatar,
    },
    likeCount: engagement.likeCount,
    repostCount: engagement.repostCount,
    replyCount: engagement.replyCount,
  };
}

function profileFromRow(row: PendingRow, followersCount: number): any {
  return {
    did: row.bsky_did,
    handle: 'someone.bsky.social',
    followersCount,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('BskyEngagementPoller.runOnce', () => {
  beforeEach(() => {
    delete process.env.BSKY_MIN_LIKES;
    delete process.env.BSKY_MIN_REPOSTS;
    delete process.env.BSKY_MIN_FOLLOWERS;
    delete process.env.BSKY_DECLINE_AFTER_DAYS;
    delete process.env.BSKY_POLL_INTERVAL_SEC;
    // Wipe the hot-reload singleton from the module-load side-effect.
    delete (globalThis as any).__bskyEngagementPoller;
  });

  test('empty batch → tick exits cleanly, no fetches, no updates', async () => {
    const { svc, calls, mockFetch } = makeService({ rows: [] });

    await svc.runOnce();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('healthy batch → fetches getPosts + getProfiles, writes engagement + author fields', async () => {
    const row = makeRow();
    const { svc, calls, mockFetch } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 5, repostCount: 1, replyCount: 0 },
            { handle: 'alice.bsky.social', displayName: 'Alice', avatar: 'https://cdn/avatar.jpg' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 100)] },
    });

    await svc.runOnce();

    // Both endpoints called.
    const urls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.some((u: string) => u.includes('app.bsky.feed.getPosts'))).toBe(true);
    expect(urls.some((u: string) => u.includes('app.bsky.actor.getProfiles'))).toBe(true);

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    const params = updates[0]!.params!;
    // Engagement values
    expect(params).toContain(5);
    expect(params).toContain(1);
    expect(params).toContain(0);
    // Author profile values
    expect(params).toContain('alice.bsky.social');
    expect(params).toContain('Alice');
    expect(params).toContain('https://cdn/avatar.jpg');
    expect(params).toContain(100);
  });

  test('promotion via likes → mirror_state becomes mirrored', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 100, repostCount: 0, replyCount: 0 },
            { handle: 'h', displayName: 'd', avatar: 'a' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 10)] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toContain('mirrored');
  });

  test('promotion via reposts only → still mirrored', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 0, repostCount: 50, replyCount: 0 },
            { handle: 'h', displayName: 'd', avatar: 'a' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 10)] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates[0]!.params).toContain('mirrored');
  });

  test('promotion via author followers only → still mirrored', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 0, repostCount: 0, replyCount: 0 },
            { handle: 'h', displayName: 'd', avatar: 'a' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 10000)] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates[0]!.params).toContain('mirrored');
  });

  test('no promotion when all signals below threshold AND row younger than decline window', async () => {
    const row = makeRow({ indexed_at: RECENT });
    const { svc, calls } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 1, repostCount: 0, replyCount: 0 },
            { handle: 'h', displayName: 'd', avatar: 'a' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 5)] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toContain('pending');
    expect(updates[0]!.params).not.toContain('mirrored');
    expect(updates[0]!.params).not.toContain('declined');
  });

  test('decline: row older than decline window AND no promotion → mirror_state becomes declined', async () => {
    const row = makeRow({ indexed_at: OLD });
    const { svc, calls } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 1, repostCount: 0, replyCount: 0 },
            { handle: 'h', displayName: 'd', avatar: 'a' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 5)] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toContain('declined');
  });

  test('API 429 → tick exits without throwing; no UPDATEs issued', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      getPostsStatus: 429,
    });

    await expect(svc.runOnce()).resolves.toBeUndefined();

    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('upstream-deleted post (uri missing from getPosts) → row stays pending, only engagement_polled_at advances', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      // getPosts returns NO posts for this uri (deleted upstream).
      postsResponse: { posts: [] },
      profilesResponse: { profiles: [] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    const params = updates[0]!.params!;
    // mirror_state stays pending — no promotion, no decline.
    expect(params).toContain('pending');
    // The engagement_polled_at advance is via NOW() in SQL or a passed
    // timestamp; either way the engagement count fields stay null.
    // (We assert SQL contains the advance, not the exact param shape.)
    expect(updates[0]!.sql).toMatch(/engagement_polled_at/i);
  });

  test('network error → tick exits without throwing; no UPDATEs issued', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      fetchError: new Error('ECONNREFUSED'),
    });

    await expect(svc.runOnce()).resolves.toBeUndefined();

    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('5xx → tick exits without throwing; no UPDATEs issued', async () => {
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      getPostsStatus: 503,
    });

    await expect(svc.runOnce()).resolves.toBeUndefined();
    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('SELECT batch query orders by oldest engagement_polled_at first (NULLs first via COALESCE)', async () => {
    const { svc, calls } = makeService({ rows: [] });

    await svc.runOnce();

    const selects = calls.filter(
      (c) => /SELECT/i.test(c.sql) && /FROM\s+bridged_posts/i.test(c.sql)
    );
    expect(selects).toHaveLength(1);
    expect(selects[0]!.sql).toMatch(/mirror_state\s*=\s*'pending'/i);
    expect(selects[0]!.sql).toMatch(/COALESCE\(\s*engagement_polled_at\s*,\s*indexed_at\s*\)/i);
    expect(selects[0]!.sql).toMatch(/LIMIT\s+25/i);
  });

  test('env override raises like threshold', async () => {
    process.env.BSKY_MIN_LIKES = '1000';
    const row = makeRow();
    const { svc, calls } = makeService({
      rows: [row],
      postsResponse: {
        posts: [
          postFromRow(
            row,
            { likeCount: 100, repostCount: 0, replyCount: 0 },
            { handle: 'h', displayName: 'd', avatar: 'a' }
          ),
        ],
      },
      profilesResponse: { profiles: [profileFromRow(row, 10)] },
    });

    await svc.runOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    // 100 likes is below 1000; row was RECENT so no decline either.
    expect(updates[0]!.params).toContain('pending');
  });
});
