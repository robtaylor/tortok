// Unit tests for the Phase 3 Unit 2.5 Jetstream subscriber. Drives
// the message handler with canned events; mocks the `query` helper
// so postgres isn't required to run the suite.
import { BskyFirehoseService, filterEvent } from '../bskyFirehose';

// ─── Test fixtures ───────────────────────────────────────────────

const PORTRAIT_EVENT = {
  did: 'did:plc:abc123',
  time_us: 1714600000000000,
  kind: 'commit',
  commit: {
    rev: 'rev-1',
    operation: 'create',
    collection: 'app.bsky.feed.post',
    rkey: '3kabc',
    record: {
      $type: 'app.bsky.feed.post',
      text: 'hello',
      createdAt: '2026-05-01T12:00:00Z',
      embed: {
        $type: 'app.bsky.embed.video',
        video: {
          ref: { $link: 'bafkrePortrait' },
          mimeType: 'video/mp4',
          size: 12345,
        },
        aspectRatio: { width: 9, height: 16 },
      },
    },
    cid: 'cid-1',
  },
};

const HORIZONTAL_EVENT = {
  ...PORTRAIT_EVENT,
  did: 'did:plc:def456',
  time_us: 1714600000000001,
  commit: {
    ...PORTRAIT_EVENT.commit,
    rkey: '3kdef',
    record: {
      ...PORTRAIT_EVENT.commit.record,
      embed: {
        $type: 'app.bsky.embed.video',
        video: { ref: { $link: 'bafkreHorizontal' } },
        aspectRatio: { width: 16, height: 9 },
      },
    },
  },
};

const NON_VIDEO_EVENT = {
  did: 'did:plc:ghi789',
  time_us: 1714600000000002,
  kind: 'commit',
  commit: {
    rev: 'rev-3',
    operation: 'create',
    collection: 'app.bsky.feed.post',
    rkey: '3kghi',
    record: {
      $type: 'app.bsky.feed.post',
      text: 'just text, no video',
      createdAt: '2026-05-01T12:01:00Z',
      // No embed at all.
    },
    cid: 'cid-3',
  },
};

const NO_OP_FACTORY = (_url: string) => {
  // Test never invokes connect(); this stub is only to satisfy
  // the constructor's signature.
  return {
    addEventListener: () => undefined,
    close: () => undefined,
  } as unknown as WebSocket;
};

// ─── filterEvent (pure-function checks) ──────────────────────────

describe('filterEvent', () => {
  test('accepts a portrait video event', () => {
    const result = filterEvent(PORTRAIT_EVENT);
    expect(result).not.toBeNull();
    expect(result?.atUri).toBe('at://did:plc:abc123/app.bsky.feed.post/3kabc');
    expect(result?.videoCid).toBe('bafkrePortrait');
    expect(result?.videoBskyPlaylistUrl).toBe(
      'https://video.bsky.app/watch/did:plc:abc123/bafkrePortrait/playlist.m3u8'
    );
    expect(result?.aspectRatioW).toBe(9);
    expect(result?.aspectRatioH).toBe(16);
    expect(result?.cursor).toBe('1714600000000000');
  });

  test('rejects a horizontal video event (aspect < 1.0)', () => {
    expect(filterEvent(HORIZONTAL_EVENT)).toBeNull();
  });

  test('rejects a non-video post', () => {
    expect(filterEvent(NON_VIDEO_EVENT)).toBeNull();
  });

  test('rejects a video without aspectRatio', () => {
    const evt = {
      ...PORTRAIT_EVENT,
      commit: {
        ...PORTRAIT_EVENT.commit,
        record: {
          ...PORTRAIT_EVENT.commit.record,
          embed: {
            $type: 'app.bsky.embed.video',
            video: { ref: { $link: 'bafkreNoAspect' } },
            // aspectRatio missing
          },
        },
      },
    };
    expect(filterEvent(evt)).toBeNull();
  });

  test('rejects a square video when aspectMin > 1.0', () => {
    const square = {
      ...PORTRAIT_EVENT,
      commit: {
        ...PORTRAIT_EVENT.commit,
        record: {
          ...PORTRAIT_EVENT.commit.record,
          embed: {
            $type: 'app.bsky.embed.video',
            video: { ref: { $link: 'bafkreSquare' } },
            aspectRatio: { width: 1, height: 1 },
          },
        },
      },
    };
    expect(filterEvent(square, 1.0)).not.toBeNull();
    expect(filterEvent(square, 1.2)).toBeNull();
  });

  test('rejects non-create operations', () => {
    const deleteEvt = {
      ...PORTRAIT_EVENT,
      commit: { ...PORTRAIT_EVENT.commit, operation: 'delete' },
    };
    expect(filterEvent(deleteEvt)).toBeNull();
  });
});

// ─── handleMessage (drives INSERT + cursor update via mock db) ───

interface QueryCall {
  sql: string;
  params: any[] | undefined;
}

function makeMockDb() {
  const calls: QueryCall[] = [];
  const mockDb = jest.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params });
    // SELECT cursor returns one empty-cursor row.
    if (/^\s*SELECT\s+cursor\s+FROM\s+bridge_cursor/i.test(sql)) {
      return [{ cursor: null }];
    }
    return [];
  });
  return { mockDb, calls };
}

function makeService(mockDb: jest.Mock): BskyFirehoseService {
  return new BskyFirehoseService(mockDb as any, NO_OP_FACTORY);
}

describe('BskyFirehoseService.handleMessage', () => {
  beforeEach(() => {
    delete process.env.BSKY_ASPECT_MIN;
    // Wipe the hot-reload singleton from the module-load side-effect.
    delete (globalThis as any).__bskyFirehose;
  });

  test('portrait video → INSERT + cursor UPDATE', async () => {
    const { mockDb, calls } = makeMockDb();
    const svc = makeService(mockDb);

    await svc.handleMessage({ data: JSON.stringify(PORTRAIT_EVENT) });

    const inserts = calls.filter((c) => /INSERT\s+INTO\s+bridged_posts/i.test(c.sql));
    expect(inserts).toHaveLength(1);
    const params = inserts[0]!.params!;
    expect(params[0]).toBe('at://did:plc:abc123/app.bsky.feed.post/3kabc');
    expect(params[1]).toBe('did:plc:abc123');
    expect(params[2]).toBe('hello');
    expect(params[3]).toBe('bafkrePortrait');
    expect(params[4]).toBe(
      'https://video.bsky.app/watch/did:plc:abc123/bafkrePortrait/playlist.m3u8'
    );

    const updates = calls.filter((c) => /UPDATE\s+bridge_cursor/i.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toEqual(['1714600000000000']);
  });

  test('horizontal video → no INSERT, no cursor UPDATE', async () => {
    const { mockDb, calls } = makeMockDb();
    const svc = makeService(mockDb);

    await svc.handleMessage({ data: JSON.stringify(HORIZONTAL_EVENT) });

    expect(calls.filter((c) => /INSERT\s+INTO\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
    expect(calls.filter((c) => /UPDATE\s+bridge_cursor/i.test(c.sql))).toHaveLength(0);
  });

  test('non-video post → no INSERT', async () => {
    const { mockDb, calls } = makeMockDb();
    const svc = makeService(mockDb);

    await svc.handleMessage({ data: JSON.stringify(NON_VIDEO_EVENT) });

    expect(calls.filter((c) => /INSERT\s+INTO\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });

  test('duplicate at-uri exercises ON CONFLICT path without throwing', async () => {
    const { mockDb, calls } = makeMockDb();
    const svc = makeService(mockDb);

    await svc.handleMessage({ data: JSON.stringify(PORTRAIT_EVENT) });
    await svc.handleMessage({ data: JSON.stringify(PORTRAIT_EVENT) });

    const inserts = calls.filter((c) => /INSERT\s+INTO\s+bridged_posts/i.test(c.sql));
    // Our code issues the INSERT both times — postgres dedupes via
    // ON CONFLICT DO NOTHING. Asserting on call count, not on what
    // postgres would actually persist.
    expect(inserts).toHaveLength(2);
    // SQL must carry the dedup clause.
    expect(inserts[0]!.sql).toMatch(/ON CONFLICT \(bsky_at_uri\) DO NOTHING/);
  });

  test('malformed JSON is swallowed silently', async () => {
    const { mockDb, calls } = makeMockDb();
    const svc = makeService(mockDb);

    await expect(
      svc.handleMessage({ data: 'not-json{{{' })
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test('BSKY_ASPECT_MIN env var raises the threshold', async () => {
    process.env.BSKY_ASPECT_MIN = '2.0';
    const { mockDb, calls } = makeMockDb();
    const svc = makeService(mockDb);

    // 9:16 is height/width = 1.78, below the 2.0 threshold → reject.
    await svc.handleMessage({ data: JSON.stringify(PORTRAIT_EVENT) });

    expect(calls.filter((c) => /INSERT\s+INTO\s+bridged_posts/i.test(c.sql))).toHaveLength(0);
  });
});
