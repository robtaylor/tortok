// Unit tests for the Phase 3 Unit 2.5 mirror pipeline (slice 3).
// Drives `runMirrorOnce()` and `runDecayOnce()` directly with mocked
// fetch + S3 client + query helpers + torrent-gen so neither
// postgres, R2, nor the Bluesky CDN are required.
import { BskyMirrorService } from '../bskyMirror';

// ─── Helpers ─────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: any[] | undefined;
}

interface MirrorRow {
  id: string;
  bsky_at_uri: string;
  bsky_did: string;
  video_cid: string;
  video_bsky_playlist_url: string;
  mirrored_at: Date | null;
  last_played_at: Date | null;
  r2_path: string | null;
}

const NOW = new Date('2026-05-15T12:00:00Z');
const RECENT = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
const STALE = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

function makeRow(overrides: Partial<MirrorRow> = {}): MirrorRow {
  return {
    id: 'row-1',
    bsky_at_uri: 'at://did:plc:abc/app.bsky.feed.post/3kabc',
    bsky_did: 'did:plc:abc',
    video_cid: 'bafkreVideoCid',
    video_bsky_playlist_url:
      'https://video.bsky.app/watch/did:plc:abc/bafkreVideoCid/playlist.m3u8',
    mirrored_at: null,
    last_played_at: null,
    r2_path: null,
    ...overrides,
  };
}

// ─── Mock builders ───────────────────────────────────────────────

interface MockEnv {
  // For mirror tick:
  mirrorRows?: MirrorRow[];
  playlistResponse?: { status?: number; body?: string };
  // Map of variant-playlist URL to its body (for variant resolution).
  subPlaylistResponses?: Record<string, { status?: number; body?: string }>;
  // Map of segment URL to its bytes (default 200 + 'AAAA').
  segmentResponses?: Record<string, { status?: number; body?: Uint8Array }>;
  // Decay:
  decayRows?: MirrorRow[];
  // S3 behavior:
  s3PutFails?: boolean;
  s3DeleteFails?: boolean;
  s3ListFails?: boolean;
  // Torrent generation:
  torrentBytes?: Uint8Array;
  torrentGenFails?: boolean;
}

interface S3Call {
  command: string;
  input: any;
}

// Stub S3 command classes — match the @aws-sdk/client-s3 surface that
// bskyMirror.ts uses. Each carries a `__cmdType` tag so the mock send()
// can dispatch without depending on real constructor names.
class PutObjectCommandStub {
  __cmdType = 'PutObjectCommand';
  constructor(public input: any) {}
}
class ListObjectsV2CommandStub {
  __cmdType = 'ListObjectsV2Command';
  constructor(public input: any) {}
}
class DeleteObjectsCommandStub {
  __cmdType = 'DeleteObjectsCommand';
  constructor(public input: any) {}
}
class DeleteObjectCommandStub {
  __cmdType = 'DeleteObjectCommand';
  constructor(public input: any) {}
}

const TEST_S3_COMMANDS = {
  PutObjectCommand: PutObjectCommandStub as any,
  ListObjectsV2Command: ListObjectsV2CommandStub as any,
  DeleteObjectsCommand: DeleteObjectsCommandStub as any,
  DeleteObjectCommand: DeleteObjectCommandStub as any,
};

function makeMockS3(env: MockEnv): { client: any; calls: S3Call[] } {
  const calls: S3Call[] = [];
  const client = {
    send: jest.fn(async (cmd: any) => {
      const command = cmd.__cmdType ?? cmd.constructor?.name ?? 'Unknown';
      calls.push({ command, input: cmd.input });
      if (command === 'PutObjectCommand') {
        if (env.s3PutFails) throw new Error('PutObject failed');
        return {};
      }
      if (command === 'ListObjectsV2Command') {
        if (env.s3ListFails) throw new Error('ListObjects failed');
        // Synthesize a fixed pair of objects under the requested
        // prefix so deletion tests have something to delete.
        const prefix = cmd.input?.Prefix ?? '';
        return {
          Contents: [
            { Key: `${prefix}playlist.m3u8` },
            { Key: `${prefix}segment0.ts` },
            { Key: `${prefix}post.torrent` },
          ],
        };
      }
      if (command === 'DeleteObjectsCommand' || command === 'DeleteObjectCommand') {
        if (env.s3DeleteFails) throw new Error('Delete failed');
        return {};
      }
      return {};
    }),
  };
  return { client, calls };
}

function makeMockDb(mirrorRows: MirrorRow[], decayRows: MirrorRow[]) {
  const calls: QueryCall[] = [];
  const mockDb = jest.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params });
    if (
      /^\s*SELECT/i.test(sql) &&
      /FROM\s+bridged_posts/i.test(sql) &&
      /r2_path\s+IS\s+NULL/i.test(sql)
    ) {
      // Honor the LIMIT param (the mirror SELECT passes batch as $1).
      const limit = typeof params?.[0] === 'number' ? params[0] : mirrorRows.length;
      return mirrorRows.slice(0, limit);
    }
    if (
      /^\s*SELECT/i.test(sql) &&
      /FROM\s+bridged_posts/i.test(sql) &&
      /r2_path\s+IS\s+NOT\s+NULL/i.test(sql)
    ) {
      return decayRows;
    }
    return [];
  });
  return { mockDb, calls };
}

function makeFetch(env: MockEnv) {
  return jest.fn(async (input: string | URL) => {
    const url = String(input);
    // Sub-playlist match (variant resolution).
    if (env.subPlaylistResponses && env.subPlaylistResponses[url]) {
      const r = env.subPlaylistResponses[url]!;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => r.body ?? '',
        arrayBuffer: async () =>
          new TextEncoder().encode(r.body ?? '').buffer as ArrayBuffer,
      } as Response;
    }
    // Top-level playlist (the URL on the row).
    if (url.endsWith('playlist.m3u8') && !url.includes('seg')) {
      const r = env.playlistResponse ?? { status: 200, body: '' };
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => r.body ?? '',
        arrayBuffer: async () =>
          new TextEncoder().encode(r.body ?? '').buffer as ArrayBuffer,
      } as Response;
    }
    // Segment fetch — match against segmentResponses or default to 200/4 bytes.
    const segResp = env.segmentResponses?.[url];
    if (segResp) {
      const status = segResp.status ?? 200;
      const body = segResp.body ?? new Uint8Array([0x41, 0x41, 0x41, 0x41]);
      return {
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: async () => body.buffer as ArrayBuffer,
        text: async () => new TextDecoder().decode(body),
      } as Response;
    }
    // Default: a tiny ts-segment-like 4-byte body, 200.
    const defaultBody = new Uint8Array([0x41, 0x41, 0x41, 0x41]);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => defaultBody.buffer as ArrayBuffer,
      text: async () => 'AAAA',
    } as Response;
  });
}

interface Built {
  svc: BskyMirrorService;
  calls: QueryCall[];
  s3Calls: S3Call[];
  mockFetch: jest.Mock;
}

function buildService(env: MockEnv): Built {
  const { mockDb, calls } = makeMockDb(env.mirrorRows ?? [], env.decayRows ?? []);
  const mockFetch = makeFetch(env);
  const { client: s3Client, calls: s3Calls } = makeMockS3(env);
  const torrentGen = jest.fn(async (_dir: string, _name: string, _opts: any) => {
    if (env.torrentGenFails) throw new Error('torrent gen failed');
    return env.torrentBytes ?? new Uint8Array([0x64, 0x38, 0x3a, 0x65]); // 'd8:e' bencode-ish
  });
  const magnetFromTorrent = jest.fn((_buf: Uint8Array, _name: string) => {
    return 'magnet:?xt=urn:btih:deadbeef0000000000000000000000000000beef';
  });
  const svc = new BskyMirrorService({
    db: mockDb as any,
    fetchFn: mockFetch as any,
    s3Client,
    s3Commands: TEST_S3_COMMANDS,
    bucket: 'tortok-content',
    webseedBase: 'https://pub-test.r2.dev',
    torrentFromDir: torrentGen as any,
    magnetFromTorrent: magnetFromTorrent as any,
    nowFn: () => NOW,
    trackers: ['wss://tracker.test'],
  });
  return { svc, calls, s3Calls, mockFetch };
}

// ─── Tests: mirror tick ──────────────────────────────────────────

describe('BskyMirrorService.runMirrorOnce', () => {
  beforeEach(() => {
    delete process.env.BSKY_MIRROR_INTERVAL_SEC;
    delete process.env.BSKY_MIRROR_BATCH;
    delete process.env.BSKY_DECAY_DAYS;
    delete process.env.BSKY_DECAY_INTERVAL_SEC;
    delete (globalThis as any).__bskyMirror;
  });

  test('no eligible rows → no fetches, no S3 calls, no UPDATEs', async () => {
    const { svc, calls, s3Calls, mockFetch } = buildService({ mirrorRows: [] });

    await svc.runMirrorOnce();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(s3Calls).toHaveLength(0);
    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('healthy mirror: playlist + 2 segments → uploads playlist + segments + .torrent, UPDATEs row', async () => {
    const row = makeRow();
    const playlist =
      '#EXTM3U\n' +
      '#EXT-X-VERSION:3\n' +
      '#EXT-X-TARGETDURATION:6\n' +
      '#EXTINF:6.0,\n' +
      'segment0.ts\n' +
      '#EXTINF:6.0,\n' +
      'segment1.ts\n' +
      '#EXT-X-ENDLIST\n';
    const { svc, calls, s3Calls } = buildService({
      mirrorRows: [row],
      playlistResponse: { body: playlist },
    });

    await svc.runMirrorOnce();

    // S3 upload calls: 2 segments + 1 playlist + 1 .torrent = 4 PutObject.
    const puts = s3Calls.filter((c) => c.command === 'PutObjectCommand');
    expect(puts).toHaveLength(4);
    const keys = puts.map((p) => p.input.Key);
    expect(keys).toContain('bridged/did:plc:abc/bafkreVideoCid/playlist.m3u8');
    expect(keys).toContain('bridged/did:plc:abc/bafkreVideoCid/segment0.ts');
    expect(keys).toContain('bridged/did:plc:abc/bafkreVideoCid/segment1.ts');
    expect(keys.some((k) => k.endsWith('.torrent'))).toBe(true);

    // UPDATE row.
    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    const params = updates[0]!.params!;
    // r2_path
    expect(params).toContain('bridged/did:plc:abc/bafkreVideoCid/');
    // magnet_link
    expect(params.some((p: any) => typeof p === 'string' && p.startsWith('magnet:?xt='))).toBe(true);
    // torrent_file_url (R2 public URL of .torrent)
    expect(
      params.some((p: any) => typeof p === 'string' && p.includes('.torrent'))
    ).toBe(true);
    // The id is in the params.
    expect(params).toContain('row-1');
  });

  test('playlist 404 → no R2 calls, no UPDATE; row unchanged for retry', async () => {
    const row = makeRow();
    const { svc, calls, s3Calls } = buildService({
      mirrorRows: [row],
      playlistResponse: { status: 404, body: '' },
    });

    await svc.runMirrorOnce();

    expect(s3Calls.filter((c) => c.command === 'PutObjectCommand')).toHaveLength(0);
    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('one segment 404 → no row UPDATE (row stays for retry)', async () => {
    const row = makeRow();
    const playlist =
      '#EXTM3U\n#EXTINF:6.0,\nsegment0.ts\n#EXTINF:6.0,\nsegment1.ts\n#EXT-X-ENDLIST\n';
    const seg0 = 'https://video.bsky.app/watch/did:plc:abc/bafkreVideoCid/segment0.ts';
    const { svc, calls } = buildService({
      mirrorRows: [row],
      playlistResponse: { body: playlist },
      segmentResponses: {
        [seg0]: { status: 404 },
      },
    });

    await svc.runMirrorOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(0);
  });

  test('variant playlist (#EXT-X-STREAM-INF) → picks highest-bandwidth track and recurses', async () => {
    const row = makeRow();
    const masterPlaylist =
      '#EXTM3U\n' +
      '#EXT-X-VERSION:4\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=480x854\n' +
      'low/playlist.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=720x1280\n' +
      'high/playlist.m3u8\n';
    const highSubPlaylist =
      '#EXTM3U\n#EXTINF:6.0,\nhigh-seg0.ts\n#EXT-X-ENDLIST\n';
    const highSubUrl =
      'https://video.bsky.app/watch/did:plc:abc/bafkreVideoCid/high/playlist.m3u8';
    const { svc, calls, s3Calls } = buildService({
      mirrorRows: [row],
      playlistResponse: { body: masterPlaylist },
      subPlaylistResponses: {
        [highSubUrl]: { body: highSubPlaylist },
      },
    });

    await svc.runMirrorOnce();

    // R2 should contain the high-variant segment, not the low one.
    const puts = s3Calls.filter((c) => c.command === 'PutObjectCommand');
    const keys = puts.map((p) => p.input.Key);
    expect(keys.some((k) => k.includes('high-seg0.ts'))).toBe(true);
    expect(keys.some((k) => k.includes('low'))).toBe(false);

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
  });

  test('multiple eligible rows but BSKY_MIRROR_BATCH=1 → only one processed per tick', async () => {
    const rowA = makeRow({ id: 'a', bsky_did: 'did:plc:a', video_cid: 'cidA' });
    const rowB = makeRow({ id: 'b', bsky_did: 'did:plc:b', video_cid: 'cidB' });
    const playlist = '#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n';
    const { svc, calls } = buildService({
      mirrorRows: [rowA, rowB],
      playlistResponse: { body: playlist },
    });

    await svc.runMirrorOnce();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    // The first row (rowA) wins by SELECT order.
    expect(updates[0]!.params).toContain('a');
  });

  test('SELECT for mirror tick filters mirror_state=mirrored AND r2_path IS NULL', async () => {
    const { svc, calls } = buildService({ mirrorRows: [] });

    await svc.runMirrorOnce();

    const selects = calls.filter(
      (c) => /SELECT/i.test(c.sql) && /FROM\s+bridged_posts/i.test(c.sql)
    );
    expect(selects.length).toBeGreaterThanOrEqual(1);
    const sel = selects[0]!;
    expect(sel.sql).toMatch(/mirror_state\s*=\s*'mirrored'/i);
    expect(sel.sql).toMatch(/r2_path\s+IS\s+NULL/i);
  });
});

// ─── Tests: decay tick ──────────────────────────────────────────

describe('BskyMirrorService.runDecayOnce', () => {
  beforeEach(() => {
    delete process.env.BSKY_DECAY_DAYS;
    delete (globalThis as any).__bskyMirror;
  });

  test('no eligible rows → no R2 deletes, no UPDATEs', async () => {
    const { svc, calls, s3Calls } = buildService({ decayRows: [] });

    await svc.runDecayOnce();

    expect(s3Calls.filter((c) => c.command.startsWith('Delete'))).toHaveLength(0);
    expect(calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('row with last_played_at older than threshold → deletes R2 prefix, UPDATEs row to expired', async () => {
    const row = makeRow({
      r2_path: 'bridged/did:plc:abc/bafkreVideoCid/',
      mirrored_at: STALE,
      last_played_at: STALE,
    });
    const { svc, calls, s3Calls } = buildService({ decayRows: [row] });

    await svc.runDecayOnce();

    // R2 list-then-delete OR DeleteObjects on the prefix's keys.
    const listCalls = s3Calls.filter((c) => c.command === 'ListObjectsV2Command');
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
    const deletes = s3Calls.filter(
      (c) => c.command === 'DeleteObjectsCommand' || c.command === 'DeleteObjectCommand'
    );
    expect(deletes.length).toBeGreaterThanOrEqual(1);

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    // mirror_state literal in SQL (no $-param), with row id as $1.
    expect(updates[0]!.sql).toMatch(/mirror_state\s*=\s*'expired'/i);
    expect(updates[0]!.params).toContain('row-1');
    // r2_path / magnet_link / torrent_file_url should be NULLed —
    // we assert SQL nulls them, not the param shape (since the
    // implementation may use literal NULLs in SQL).
    expect(updates[0]!.sql).toMatch(/r2_path\s*=\s*NULL/i);
    expect(updates[0]!.sql).toMatch(/magnet_link\s*=\s*NULL/i);
  });

  test('never-played row with mirrored_at older than threshold → also decays', async () => {
    const row = makeRow({
      r2_path: 'bridged/did:plc:abc/bafkreVideoCid/',
      mirrored_at: STALE,
      last_played_at: null,
    });
    const { svc, calls, s3Calls } = buildService({ decayRows: [row] });

    await svc.runDecayOnce();

    const deletes = s3Calls.filter(
      (c) => c.command === 'DeleteObjectsCommand' || c.command === 'DeleteObjectCommand'
    );
    expect(deletes.length).toBeGreaterThanOrEqual(1);
    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toMatch(/mirror_state\s*=\s*'expired'/i);
  });

  test('R2 delete fails → row stays mirrored (no UPDATE), error swallowed', async () => {
    const row = makeRow({
      r2_path: 'bridged/did:plc:abc/bafkreVideoCid/',
      mirrored_at: STALE,
      last_played_at: STALE,
    });
    const { svc, calls } = buildService({
      decayRows: [row],
      s3DeleteFails: true,
    });

    await expect(svc.runDecayOnce()).resolves.toBeUndefined();

    const updates = calls.filter((c) => /UPDATE\s+bridged_posts/i.test(c.sql));
    expect(updates).toHaveLength(0);
  });

  test('SELECT for decay filters mirror_state=mirrored AND r2_path IS NOT NULL', async () => {
    const { svc, calls } = buildService({ decayRows: [] });

    await svc.runDecayOnce();

    const selects = calls.filter(
      (c) => /SELECT/i.test(c.sql) && /FROM\s+bridged_posts/i.test(c.sql)
    );
    expect(selects.length).toBeGreaterThanOrEqual(1);
    const sel = selects[0]!;
    expect(sel.sql).toMatch(/mirror_state\s*=\s*'mirrored'/i);
    expect(sel.sql).toMatch(/r2_path\s+IS\s+NOT\s+NULL/i);
  });
});

// ─── Tests: stop ─────────────────────────────────────────────────

describe('BskyMirrorService.stop', () => {
  beforeEach(() => {
    delete (globalThis as any).__bskyMirror;
  });

  test('stop() cancels both intervals and sets stopRequested', () => {
    const { svc } = buildService({});
    svc.start();
    expect(() => svc.stop()).not.toThrow();
    // After stop, an in-flight tick that observes stopRequested
    // should bail out quickly. We don't drive a tick here — just
    // assert stop is idempotent and clears timers.
    expect(() => svc.stop()).not.toThrow();
  });
});
