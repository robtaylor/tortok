// The Bluesky bridge end to end (plan 2.5D step 22, Decision 0023): commits in
// as Jetstream messages on a stubbed socket, the engagement poller run against
// a stubbed Bluesky AppView, and GET /videos/feed out. bskyFirehose.test.ts
// and bskyEngagementPoller.test.ts cover each service's details; these check
// what a viewer of the feed is served: nothing below the thresholds, nothing
// labelled NSFW, nothing deleted on Bluesky, and nothing by an author who
// opted out, which release-plan.md makes a Beta criterion. Against a real
// Postgres (Decision 0016).

import { createTestDb, TestDb } from './helpers/testDb';
// Type-only and db-free imports here: anything that loads ../db must wait
// for createTestDb() (below), or its pool connects to the dev database.
import type { BskyFirehose as FirehoseT } from '../services/bskyFirehose';
import type { BskyEngagementPoller as PollerT } from '../services/bskyEngagementPoller';
import { BSKY_POST_NSID as NSID } from '../atproto/bskyPost';
import { VIDEO_POST_NSID } from '../atproto/videoPost';
import { AppViewStub, fakeAppView, lbl, postView, profileUri, profileView } from './helpers/fakeAppView';
import { commitEvent, fakeSockets } from './helpers/fakeSocket';
import { bskyPostUri as uri, INFO_HASH, selfLabelsField, videoRecord } from './helpers/fixtures';
import { feedRkeys, startFeedServer, TestServer } from './helpers/testServer';

const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let testDb: TestDb;
let db: typeof import('../db');
let Firehose: typeof FirehoseT;
let Poller: typeof PollerT;
let server: TestServer;

let poller: PollerT;
/** What Bluesky's AppView says; tests change it between polls. */
let appview: AppViewStub;
/** How far the poller's clock is ahead of the real one. */
let ahead: number;

beforeAll(async () => {
  testDb = await createTestDb();
  db = await import('../db');
  ({ BskyFirehose: Firehose } = await import('../services/bskyFirehose'));
  ({ BskyEngagementPoller: Poller } = await import('../services/bskyEngagementPoller'));
  await db.initializeDatabase();
  server = await startFeedServer();
});

afterAll(async () => {
  server?.close();
  await db?.closeDatabase();
  await testDb?.drop();
});

beforeEach(async () => {
  await db.query('TRUNCATE posts, labels, bridge_authors, ingest_cursor');
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
  appview = { posts: [], profiles: [profileView(ALICE), profileView(BOB)] };
  ahead = 0;
  poller = new Poller({
    fetch: fakeAppView(appview).fetch,
    now: () => new Date(Date.now() + ahead),
    thresholds: { minLikes: 50, minReposts: 10, minFollowers: 5000, qualifyDays: 7 },
    recheckDays: 30,
  });
});

afterEach(() => jest.restoreAllMocks());

const commit = (did: string, rkey: string, operation: string, record?: unknown, cid?: string) =>
  commitEvent(NSID, did, rkey, operation, record, cid);

/** Deliver commits as Jetstream does, as messages on a firehose's socket; stop() returns once all are handled. */
async function jetstream(...events: object[]) {
  const { sockets, wsFactory } = fakeSockets();
  const firehose = new Firehose({ wsFactory });
  await firehose.start();
  for (const e of events) sockets[0].deliver(e);
  await firehose.stop();
}

/** Set what the AppView returns for a post. */
function view(did: string, rkey: string, over: Record<string, unknown>) {
  const u = uri(did, rkey);
  appview.posts = [...appview.posts.filter((p) => p.uri !== u), postView(u, over)];
}

/** Set what the AppView returns for an author's profile. */
function profile(did: string, over: Record<string, unknown>) {
  appview.profiles = [...appview.profiles.filter((p) => p.did !== did), profileView(did, over)];
}

interface Video {
  did: string;
  rkey: string;
  /** Record fields over the fixture's. */
  record?: Record<string, unknown>;
  /** How long ago it was posted. */
  ageMs?: number;
}

/**
 * Publish video posts on Bluesky: the AppView has each, with 500 likes (enough
 * to qualify, so a test that isn't about thresholds needn't say), and their
 * commits arrive on Jetstream. createdAt is relative to the real clock, since
 * the poller drops by age.
 */
async function publish(...videos: Video[]) {
  for (const v of videos) view(v.did, v.rkey, { likeCount: 500 });
  await jetstream(...videos.map((v) => commit(v.did, v.rkey, 'create',
    videoRecord({ createdAt: new Date(Date.now() - (v.ageMs ?? HOUR)).toISOString(), ...v.record }))));
}

/**
 * One poll, a day and an hour after the last: later than any scheduled check,
 * so every post still in the queue is due, and every author's profile is read
 * again.
 */
async function poll() {
  ahead += 25 * HOUR;
  return poller.runOnce();
}

/** The rkeys GET /videos/feed serves, sorted. */
async function feed(): Promise<string[]> {
  const { status, body } = await server.getJson('/videos/feed');
  expect(status).toBe(200);
  return feedRkeys(body).sort();
}

/** The rkeys of every bridged row, served or not, sorted. */
const indexed = () =>
  db.query<{ rkey: string }>('SELECT rkey FROM posts WHERE collection = $1 ORDER BY rkey', [NSID]).then((r) => r.map((x) => x.rkey));

const labelVals = (subject: string) =>
  db.query<{ val: string }>('SELECT val FROM labels WHERE subject = $1 ORDER BY val', [subject]).then((r) => r.map((x) => x.val));

describe('thresholds', () => {
  test('a post reaches the feed once it meets a threshold, and not before', async () => {
    await publish({ did: ALICE, rkey: 'liked' }, { did: ALICE, rkey: 'quiet' });
    view(ALICE, 'liked', { likeCount: 50 });
    view(ALICE, 'quiet', { likeCount: 49, repostCount: 9 });
    // Indexed, but nothing is served before the poller has checked it.
    expect(await indexed()).toEqual(['liked', 'quiet']);
    expect(await feed()).toEqual([]);

    await poll();
    const { body } = await server.getJson('/videos/feed');
    expect(feedRkeys(body)).toEqual(['liked']);
    expect(body.videos[0].playback.kind).toBe('hls');

    view(ALICE, 'quiet', { likeCount: 49, repostCount: 10 });
    await poll();
    expect(await feed()).toEqual(['liked', 'quiet']);
  });

  test('an edited post waits for the poller again', async () => {
    await publish({ did: ALICE, rkey: 'a' });
    await poll();
    expect(await feed()).toEqual(['a']);

    await jetstream(commit(ALICE, 'a', 'update', videoRecord({ text: 'edited', createdAt: new Date().toISOString() }), 'bafyrec2'));
    expect(await feed()).toEqual([]);
    await poll();
    expect(await feed()).toEqual(['a']);
  });

  test('a post that has not qualified within 7 days is dropped', async () => {
    await publish({ did: ALICE, rkey: 'quiet', ageMs: 5 * DAY }, { did: BOB, rkey: 'liked', ageMs: 5 * DAY });
    view(ALICE, 'quiet', { likeCount: 3 });
    await poll();
    expect(await indexed()).toEqual(['liked', 'quiet']);
    await poll(); // now a little over 7 days old
    expect(await indexed()).toEqual(['liked']);
    expect(await feed()).toEqual(['liked']);
  });
});

describe('NSFW (Decision 0023 item 1)', () => {
  test('a self-labelled NSFW post is not indexed, whatever its engagement; its labels are stored', async () => {
    await publish({ did: ALICE, rkey: 'nsfw', record: { labels: selfLabelsField('porn') } }, { did: ALICE, rkey: 'fine' });
    expect(await indexed()).toEqual(['fine']);
    await poll();
    expect(await feed()).toEqual(['fine']);
    expect(await labelVals(uri(ALICE, 'nsfw'))).toEqual(['porn']);
  });

  test.each(['porn', 'graphic-media', '!takedown'])(
    'a served post that a labeler then labels %s leaves the feed at its next check', async (val) => {
      await publish({ did: ALICE, rkey: 'a' }, { did: ALICE, rkey: 'b' });
      await poll();
      expect(await feed()).toEqual(['a', 'b']);

      view(ALICE, 'a', { likeCount: 500, labels: [lbl(uri(ALICE, 'a'), val)] });
      await poll();
      expect(await feed()).toEqual(['b']);
      // The label outlives the row (item 2).
      expect(await labelVals(uri(ALICE, 'a'))).toEqual([val]);
    });

  test('an edit that adds an NSFW self-label takes a served post out of the feed at once', async () => {
    await publish({ did: ALICE, rkey: 'a' });
    await poll();
    expect(await feed()).toEqual(['a']);

    await jetstream(commit(ALICE, 'a', 'update', videoRecord({ labels: selfLabelsField('nudity') }), 'bafyrec2'));
    expect(await feed()).toEqual([]);
  });

  test('an account a labeler labels NSFW loses every bridged post, and later ones are not indexed', async () => {
    // 'old' is past the 30-day recheck horizon: it qualifies on its first
    // check and is never due again.
    await publish({ did: ALICE, rkey: 'old', ageMs: 40 * DAY }, { did: ALICE, rkey: 'new' }, { did: BOB, rkey: 'b' });
    await poll();
    expect(await feed()).toEqual(['b', 'new', 'old']);

    view(ALICE, 'new', { likeCount: 500, author: { labels: [lbl(ALICE, 'porn')] } });
    await poll();
    expect(await feed()).toEqual(['b']);
    expect(await indexed()).toEqual(['b']);

    await publish({ did: ALICE, rkey: 'later' });
    expect(await indexed()).toEqual(['b']);
  });
});

describe('opt-out (Decision 0023 item 4)', () => {
  const SIGNALS: [string, Record<string, unknown>][] = [
    ['!no-unauthenticated on the profile', { labels: [lbl(profileUri(ALICE), '!no-unauthenticated', ALICE)] }],
    ['#nobridge in the bio', { description: 'Painter. #nobridge' }],
    ['#nobridge in the display name', { displayName: 'Alice #NoBridge' }],
  ];

  test.each(SIGNALS)('%s: the author is never served, and their later posts are not indexed', async (_signal, optOut) => {
    profile(ALICE, optOut);
    await publish({ did: ALICE, rkey: 'a' }, { did: BOB, rkey: 'b' });
    await poll();
    expect(await feed()).toEqual(['b']);
    expect(await indexed()).toEqual(['b']);

    await publish({ did: ALICE, rkey: 'later' });
    expect(await indexed()).toEqual(['b']);
  });

  test.each(SIGNALS)('%s, added once the author is in the feed: every bridged post of theirs goes', async (_signal, optOut) => {
    // 'old' is past the 30-day recheck horizon, so no check of its own would
    // ever remove it.
    await publish({ did: ALICE, rkey: 'old', ageMs: 40 * DAY }, { did: ALICE, rkey: 'new' }, { did: BOB, rkey: 'b' });
    await poll();
    expect(await feed()).toEqual(['b', 'new', 'old']);

    profile(ALICE, optOut);
    await poll();
    expect(await feed()).toEqual(['b']);
    expect(await indexed()).toEqual(['b']);
  });

  test("opting out of the bridge leaves the author's own tortok posts alone", async () => {
    await db.query(
      `INSERT INTO posts (at_uri, did, collection, rkey, cid, magnet_link, record_created_at)
       VALUES ($1, $2, $3, 'native', 'bafynative', 'magnet:?xt=urn:btih:${INFO_HASH}', NOW())`,
      [`at://${ALICE}/${VIDEO_POST_NSID}/native`, ALICE, VIDEO_POST_NSID]);
    await publish({ did: ALICE, rkey: 'a' });
    await poll();
    expect(await feed()).toEqual(['a', 'native']);

    profile(ALICE, { description: '#nobridge' });
    await poll();
    expect(await feed()).toEqual(['native']);
  });
});

describe('deleted on Bluesky', () => {
  test('a deleted post leaves the feed: at once on the Jetstream delete, else at its next check', async () => {
    await publish({ did: ALICE, rkey: 'a' }, { did: ALICE, rkey: 'b' }, { did: ALICE, rkey: 'c' });
    await poll();
    expect(await feed()).toEqual(['a', 'b', 'c']);

    await jetstream(commit(ALICE, 'a', 'delete'));
    expect(await feed()).toEqual(['b', 'c']);

    // A delete the bridge missed, or a takedown: the AppView no longer returns the post.
    appview.posts = appview.posts.filter((p) => p.uri !== uri(ALICE, 'b'));
    await poll();
    expect(await feed()).toEqual(['c']);
  });
});
