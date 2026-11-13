// The Bluesky bridge's firehose (plan 2.5D step 17, Decision 0023): which
// app.bsky.feed.post records it indexes, the NSFW and opt-out drops, labels
// written whatever happens, edits and deletes. Against a real Postgres
// (Decision 0016); Jetstream is stubbed.

import { createTestDb, TestDb } from './helpers/testDb';
import { hlsUrl, parseBskyVideoPost } from '../atproto/bskyPost';
import type { BskyFirehose as BskyFirehoseT } from '../services/bskyFirehose';
import { fakeSockets } from './helpers/fakeSocket';
import { VIDEO_CID, videoRecord } from './helpers/fixtures';

const NOW = new Date('2026-11-12T12:00:00Z');

const NSID = 'app.bsky.feed.post';
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const selfLabelled = (...vals: string[]) => videoRecord({ labels: { $type: 'com.atproto.label.defs#selfLabels', values: vals.map((val) => ({ val })) } });

describe('parseBskyVideoPost', () => {
  test('reads a portrait video post', () => {
    expect(parseBskyVideoPost(ALICE, videoRecord({ tags: ['dogs', '#cats'] }), 1, NOW)).toEqual({
      videoCid: VIDEO_CID,
      hlsUrl: `https://video.bsky.app/watch/did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa/${VIDEO_CID}/playlist.m3u8`,
      width: 9, height: 16, text: 'a clip #cats', hashtags: ['#dogs', '#cats'],
      createdAt: new Date('2026-11-12T10:00:00.000Z'),
    });
  });

  test('takes the video from recordWithMedia', () => {
    const { embed } = videoRecord();
    const record = videoRecord({ embed: { $type: 'app.bsky.embed.recordWithMedia', record: {}, media: embed } });
    expect(parseBskyVideoPost(ALICE, record, 1, NOW)).toMatchObject({ videoCid: VIDEO_CID });
  });

  test('rejects non-video, unsized, too-wide and malformed posts', () => {
    expect(parseBskyVideoPost(ALICE, { text: 'hi', createdAt: NOW.toISOString() }, 1, NOW)).toBe('no-video');
    expect(parseBskyVideoPost(ALICE, videoRecord({ embed: { $type: 'app.bsky.embed.images' } }), 1, NOW)).toBe('no-video');
    expect(parseBskyVideoPost(ALICE, videoRecord({}, null), 1, NOW)).toBe('no-aspect-ratio');
    expect(parseBskyVideoPost(ALICE, videoRecord({}, { width: 0, height: 16 }), 1, NOW)).toBe('no-aspect-ratio');
    expect(parseBskyVideoPost(ALICE, videoRecord({}, { width: 16, height: 9 }), 1, NOW)).toBe('too-wide');
    expect(parseBskyVideoPost(ALICE, videoRecord({}, { width: 16, height: 9 }), 0.5, NOW)).toMatchObject({ width: 16 });
    const badCid = videoRecord();
    (badCid.embed.video.ref as { $link: string }).$link = '../../etc';
    expect(parseBskyVideoPost(ALICE, badCid, 1, NOW)).toBe('bad-video-blob');
    expect(parseBskyVideoPost(ALICE, videoRecord({ createdAt: 'soon' }), 1, NOW)).toBe('bad-created-at');
  });

  test('clamps a future createdAt to now', () => {
    expect(parseBskyVideoPost(ALICE, videoRecord({ createdAt: '2030-01-01T00:00:00Z' }), 1, NOW))
      .toMatchObject({ createdAt: NOW });
  });

  test('hlsUrl percent-encodes the DID', () => {
    expect(hlsUrl('did:web:example.com', VIDEO_CID)).toContain('/watch/did%3Aweb%3Aexample.com/');
  });
});

describe('BskyFirehose', () => {
  let testDb: TestDb;
  let db: typeof import('../db');
  let BskyFirehose: typeof BskyFirehoseT;

  const make = () => {
    const { sockets, wsFactory } = fakeSockets();
    return { bridge: new BskyFirehose({ wsFactory }), sockets };
  };

  const event = (operation: string, record?: unknown, rkey = '3kvid', cid = 'bafyrecord1') =>
    ({ did: ALICE, time_us: 1_000, kind: 'commit', commit: { operation, collection: NSID, rkey, cid, record } });

  const uri = (rkey = '3kvid') => `at://${ALICE}/${NSID}/${rkey}`;
  const posts = () => db.query('SELECT * FROM posts ORDER BY at_uri');
  const labelVals = (subject = uri()) =>
    db.query<{ val: string }>('SELECT val FROM labels WHERE subject = $1 ORDER BY val', [subject]).then((r) => r.map((x) => x.val));

  beforeAll(async () => {
    testDb = await createTestDb();
    db = await import('../db');
    ({ BskyFirehose } = await import('../services/bskyFirehose'));
    await db.initializeDatabase();
  });

  afterAll(async () => {
    await db?.closeDatabase();
    await testDb?.drop();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE posts, labels, ingest_cursor');
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  test('indexes a portrait video post as an unchecked bridged row', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', videoRecord()));
    const [row] = await posts();
    expect(row).toMatchObject({
      at_uri: uri(), did: ALICE, collection: NSID, rkey: '3kvid', cid: 'bafyrecord1',
      text: 'a clip #cats', video_cid: VIDEO_CID, hls_url: hlsUrl(ALICE, VIDEO_CID),
      width: 9, height: 16, hashtags: ['#cats'], magnet_link: null,
      bridge_checked_at: null, bridge_qualified_at: null,
    });
    expect(bridge.stats.indexed).toBe(1);
  });

  test('ignores non-video posts, other collections and bad identifiers', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', { text: 'just words', createdAt: NOW.toISOString() }));
    await bridge.handleEvent({ ...event('create', videoRecord()), commit: { ...event('create').commit, collection: 'app.bsky.feed.like', record: videoRecord() } });
    await bridge.handleEvent({ ...event('create', videoRecord()), did: 'did:example:nope' });
    await bridge.handleEvent(event('create', videoRecord(), 'bad/rkey'));
    await bridge.handleEvent(event('create', videoRecord(), '3kvid', ''));
    expect(await posts()).toEqual([]);
  });

  test('a self-labelled NSFW post is not indexed, but its labels are stored', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', selfLabelled('porn', 'spoiler')));
    expect(await posts()).toEqual([]);
    expect(await labelVals()).toEqual(['porn', 'spoiler']);
    expect(bridge.stats.nsfw).toBe(1);
  });

  test('an edit that adds an NSFW self-label removes the row; removing it again replaces the labels', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', videoRecord()));
    await bridge.handleEvent(event('update', selfLabelled('nudity'), '3kvid', 'bafyrecord2'));
    expect(await posts()).toEqual([]);
    expect(await labelVals()).toEqual(['nudity']);
    await bridge.handleEvent(event('update', videoRecord(), '3kvid', 'bafyrecord3'));
    expect(await posts()).toHaveLength(1);
    expect(await labelVals()).toEqual([]);
  });

  test('authors labelled NSFW or opted out are not indexed; a negated label does not count', async () => {
    const { bridge } = make();
    const authorLabel = (val: string, neg = false) => db.query(
      `INSERT INTO labels (subject, src, val, neg, cts) VALUES ($1, $1, $2, $3, NOW())
       ON CONFLICT (subject, subject_cid, src, val) DO UPDATE SET neg = EXCLUDED.neg`, [ALICE, val, neg]);

    await authorLabel('!no-unauthenticated');
    await bridge.handleEvent(event('create', videoRecord()));
    expect(await posts()).toEqual([]);
    expect(bridge.stats['author-excluded']).toBe(1);

    await authorLabel('!no-unauthenticated', true);
    await bridge.handleEvent(event('create', videoRecord()));
    expect(await posts()).toHaveLength(1);

    await authorLabel('sexual');
    await bridge.handleEvent(event('update', videoRecord(), '3kvid', 'bafyrecord2'));
    expect(await posts()).toEqual([]);
  });

  test('authors the poller recorded as saying #nobridge are not indexed', async () => {
    const { bridge } = make();
    await db.query(`INSERT INTO bridge_authors (did, nobridge) VALUES ($1, true)`, [ALICE]);
    await bridge.handleEvent(event('create', videoRecord()));
    expect(await posts()).toEqual([]);
    await db.query('TRUNCATE bridge_authors');
  });

  test('an edit resets the poller state; a replay of the same version does not', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', videoRecord()));
    expect((await posts())[0].bridge_next_check_at).not.toBeNull(); // due on insert
    const later = new Date(Date.now() + 86_400_000);
    await db.query('UPDATE posts SET bridge_qualified_at = NOW(), bridge_next_check_at = $1', [later]);
    await bridge.handleEvent(event('create', videoRecord()));
    expect((await posts())[0]).toMatchObject({ bridge_next_check_at: later });
    expect((await posts())[0].bridge_qualified_at).not.toBeNull();
    await bridge.handleEvent(event('update', videoRecord({ text: 'edited' }), '3kvid', 'bafyrecord2'));
    const [edited] = await posts();
    expect(edited).toMatchObject({ text: 'edited', bridge_qualified_at: null });
    expect(edited.bridge_next_check_at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('an edit that makes the post landscape removes it', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', videoRecord()));
    await bridge.handleEvent(event('update', videoRecord({}, { width: 16, height: 9 }), '3kvid', 'bafyrecord2'));
    expect(await posts()).toEqual([]);
  });

  test('a delete removes the row and keeps its labels', async () => {
    const { bridge } = make();
    await bridge.handleEvent(event('create', selfLabelled('spoiler')));
    await bridge.handleEvent(event('delete'));
    expect(await posts()).toEqual([]);
    expect(await labelVals()).toEqual(['spoiler']);
    expect(bridge.stats.deleted).toBe(1);
  });

  test('subscribes to app.bsky.feed.post with its own cursor, apart from native ingest', async () => {
    await db.query(`INSERT INTO ingest_cursor (key, cursor) VALUES ('jetstream', 99000000)`);
    const first = make();
    await first.bridge.start();
    expect(first.sockets[0].url).toBe(
      'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post');
    first.sockets[0].emit('message', Buffer.from(JSON.stringify({ ...event('create', videoRecord()), time_us: 20_000_000 })));
    await first.bridge.stop();
    expect(await db.query('SELECT key, cursor FROM ingest_cursor ORDER BY key')).toEqual([
      { key: 'jetstream', cursor: '99000000' },
      { key: 'jetstream-bsky-posts', cursor: '20000000' },
    ]);
    expect(await posts()).toHaveLength(1);

    const second = make();
    await second.bridge.start();
    expect(new URL(second.sockets[0].url).searchParams.get('cursor')).toBe('15000000');
    await second.bridge.stop();
  });
});
