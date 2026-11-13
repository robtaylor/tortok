// The bridge's engagement poller (plan 2.5D step 18, Decisions 0023 and
// 0024): labels stored, NSFW/gone/opted-out rows dropped, thresholds, the
// 7-day cutoff, the decaying schedule and the 30 days a post is kept.
// Against a real Postgres (Decision 0016); Bluesky's AppView is stubbed.

import { createTestDb, TestDb } from './helpers/testDb';
// Type-only and db-free imports here: anything that loads ../db must wait
// for createTestDb() (below), or its pool connects to the dev database.
import type { BskyEngagementPoller as PollerT, PollerOptions } from '../services/bskyEngagementPoller';
import { BSKY_POST_NSID as NSID } from '../atproto/bskyPost';
import { VIDEO_POST_NSID } from '../atproto/videoPost';
import { AppViewStub, fakeAppView, lbl, MOD, postView, profileUri, profileView } from './helpers/fakeAppView';
import { bskyPostUri as uri } from './helpers/fixtures';

const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = new Date('2026-11-12T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

let testDb: TestDb;
let db: typeof import('../db');
let Poller: typeof PollerT;
let nextCheckDelayMs: typeof import('../services/bskyEngagementPoller').nextCheckDelayMs;
let saysNoBridge: typeof import('../services/bridgePolicy').saysNoBridge;

beforeAll(async () => {
  testDb = await createTestDb();
  db = await import('../db');
  ({ BskyEngagementPoller: Poller, nextCheckDelayMs } = await import('../services/bskyEngagementPoller'));
  ({ saysNoBridge } = await import('../services/bridgePolicy'));
  await db.initializeDatabase();
});

afterAll(async () => {
  await db?.closeDatabase();
  await testDb?.drop();
});

beforeEach(async () => {
  await db.query('TRUNCATE posts, labels, bridge_authors');
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/** Insert a bridged row as the firehose would, indexed and dated `ageMs` ago, and due since then unless `dueAt` says otherwise. */
async function bridged(did: string, rkey: string, ageMs = HOUR, dueAt?: Date) {
  const indexedAt = new Date(NOW.getTime() - ageMs);
  await db.query(
    `INSERT INTO posts (at_uri, did, collection, rkey, cid, video_cid, width, height, record_created_at, indexed_at, bridge_next_check_at)
     VALUES ($1, $2, $3, $4, 'bafyrec', 'bafyvid', 9, 16, $5, $5, $6)`,
    [uri(did, rkey), did, NSID, rkey, indexedAt, dueAt ?? indexedAt]);
}

function makePoller(stub: AppViewStub, opts: PollerOptions = {}) {
  const { fetch, calls } = fakeAppView(stub);
  const poller = new Poller({
    fetch, now: () => NOW,
    thresholds: { minLikes: 50, minReposts: 10, minFollowers: 5000, qualifyDays: 7 },
    recheckDays: 30,
    ...opts,
  });
  return { poller, calls };
}

const row = (u: string) => db.query<Record<string, any>>('SELECT * FROM posts WHERE at_uri = $1', [u]).then((r) => r[0]);

test('nextCheckDelayMs is half the age, between 15 minutes and a day', () => {
  expect(nextCheckDelayMs(0)).toBe(15 * MIN);
  expect(nextCheckDelayMs(4 * HOUR)).toBe(2 * HOUR);
  expect(nextCheckDelayMs(10 * DAY)).toBe(DAY);
});

test('saysNoBridge finds #nobridge in any of the texts', () => {
  expect(saysNoBridge(null, 'art, #NoBridge please')).toBe(true);
  expect(saysNoBridge('#nobridges', undefined)).toBe(false);
});

test('qualifies a post on likes, reposts or author followers, and reschedules it', async () => {
  for (const r of ['likes', 'reposts', 'followers', 'none']) await bridged(r === 'followers' ? BOB : ALICE, r);
  const { poller } = makePoller({
    posts: [
      postView(uri(ALICE, 'likes'), { likeCount: 50 }),
      postView(uri(ALICE, 'reposts'), { repostCount: 10 }),
      postView(uri(BOB, 'followers')),
      postView(uri(ALICE, 'none'), { likeCount: 49, repostCount: 9 }),
    ],
    profiles: [profileView(ALICE), profileView(BOB, { followersCount: 5000 })],
  });
  expect(await poller.runOnce()).toEqual({ checked: 4, qualified: 3, dropped: 0 });
  for (const r of ['likes', 'reposts']) expect((await row(uri(ALICE, r))).bridge_qualified_at).toEqual(NOW);
  expect((await row(uri(BOB, 'followers'))).bridge_qualified_at).toEqual(NOW);
  const none = await row(uri(ALICE, 'none'));
  expect(none).toMatchObject({ bridge_qualified_at: null, bridge_checked_at: NOW });
  // An hour old: next check in 30 minutes.
  expect(none.bridge_next_check_at).toEqual(new Date(NOW.getTime() + 30 * MIN));
  // Nothing is due any more.
  expect(await poller.runOnce()).toEqual({ checked: 0, qualified: 0, dropped: 0 });
});

test('drops a post gone from the AppView, labelled NSFW, or unqualified after 7 days', async () => {
  await bridged(ALICE, 'gone');
  await bridged(ALICE, 'porn');
  await bridged(ALICE, 'negated');
  await bridged(ALICE, 'old', 8 * DAY);
  const { poller } = makePoller({
    posts: [
      postView(uri(ALICE, 'porn'), { likeCount: 500, labels: [lbl(uri(ALICE, 'porn'), 'porn', MOD, { cid: 'bafyrec' })] }),
      postView(uri(ALICE, 'negated'), { labels: [lbl(uri(ALICE, 'negated'), 'porn', MOD, { neg: true })] }),
      postView(uri(ALICE, 'old'), { likeCount: 3 }),
    ],
    profiles: [profileView(ALICE)],
  });
  expect(await poller.runOnce()).toMatchObject({ checked: 4, dropped: 3 });
  expect((await db.query('SELECT rkey FROM posts')).map((r: any) => r.rkey)).toEqual(['negated']);
  // Labels are kept whatever happens to the post.
  expect(await db.query('SELECT subject, val, neg FROM labels ORDER BY subject')).toEqual([
    { subject: uri(ALICE, 'negated'), val: 'porn', neg: true },
    { subject: uri(ALICE, 'porn'), val: 'porn', neg: false },
  ]);
});

test('a qualified post that ages past 7 days stays, on a daily schedule, until it is 30 days old; then it is deleted', async () => {
  await bridged(ALICE, 'q', 10 * DAY);
  await bridged(ALICE, 'old', 31 * DAY);
  await db.query('UPDATE posts SET bridge_qualified_at = $1', [new Date(NOW.getTime() - 9 * DAY)]);
  const { poller } = makePoller(
    { posts: [postView(uri(ALICE, 'q')), postView(uri(ALICE, 'old'))], profiles: [profileView(ALICE)] });
  expect(await poller.runOnce()).toEqual({ checked: 2, qualified: 0, dropped: 1 });
  expect((await row(uri(ALICE, 'q'))).bridge_next_check_at).toEqual(new Date(NOW.getTime() + DAY));
  // Past 30 days it goes, rather than staying in the feed unchecked (Decision 0024 item 1).
  expect(await row(uri(ALICE, 'old'))).toBeUndefined();
});

test("a post's age counts from when the bridge indexed it, not from its createdAt", async () => {
  // Both indexed an hour ago. One is dated 40 days back, past the 30 days;
  // the other 8 days back, past the 7 it has to qualify.
  await bridged(BOB, 'famous');
  await bridged(ALICE, 'quiet');
  const dated = (rkey: string, daysAgo: number) =>
    db.query('UPDATE posts SET record_created_at = $1 WHERE rkey = $2', [new Date(NOW.getTime() - daysAgo * DAY), rkey]);
  await dated('famous', 40);
  await dated('quiet', 8);
  const { poller } = makePoller({
    posts: [postView(uri(BOB, 'famous')), postView(uri(ALICE, 'quiet'), { likeCount: 3 })],
    profiles: [profileView(ALICE), profileView(BOB, { followersCount: 5000 })],
  });
  expect(await poller.runOnce()).toEqual({ checked: 2, qualified: 1, dropped: 0 });
  // Each is checked again in 30 minutes, like any post indexed an hour ago.
  for (const u of [uri(BOB, 'famous'), uri(ALICE, 'quiet')]) {
    expect((await row(u)).bridge_next_check_at).toEqual(new Date(NOW.getTime() + 30 * MIN));
  }
});

test('opted-out authors are recorded and their posts dropped: !no-unauthenticated or #nobridge', async () => {
  await bridged(ALICE, 'a');
  await bridged(BOB, 'b');
  const { poller } = makePoller({
    posts: [postView(uri(ALICE, 'a'), { likeCount: 500 }), postView(uri(BOB, 'b'), { likeCount: 500 })],
    profiles: [
      profileView(ALICE, { labels: [lbl(profileUri(ALICE), '!no-unauthenticated', ALICE)] }),
      profileView(BOB, { description: 'no thanks #nobridge' }),
    ],
  });
  expect(await poller.runOnce()).toMatchObject({ dropped: 2, qualified: 0 });
  // #nobridge is recorded; the label lives in `labels`.
  expect(await db.query('SELECT did, nobridge FROM bridge_authors ORDER BY did'))
    .toEqual([{ did: ALICE, nobridge: false }, { did: BOB, nobridge: true }]);
  expect(await db.query('SELECT subject, src, subject_cid FROM labels WHERE val = $1', ['!no-unauthenticated']))
    .toEqual([{ subject: profileUri(ALICE), src: ALICE, subject_cid: '' }]);
});

test("an excluded author's bridged posts all go, due or not; their tortok posts and other authors' stay", async () => {
  const inAnHour = new Date(NOW.getTime() + HOUR);
  await bridged(ALICE, 'due');
  await bridged(ALICE, 'later', HOUR, inAnHour);
  // Served, and checked a moment ago.
  await bridged(ALICE, 'served', 20 * DAY, new Date(NOW.getTime() + DAY));
  await db.query(`UPDATE posts SET bridge_qualified_at = $1 WHERE rkey = 'served'`, [NOW]);
  await bridged(BOB, 'b', HOUR, inAnHour);
  const native = `at://${ALICE}/${VIDEO_POST_NSID}/native`;
  await db.query(
    `INSERT INTO posts (at_uri, did, collection, rkey, cid, record_created_at)
     VALUES ($1, $2, $3, 'native', 'bafynative', $4)`, [native, ALICE, VIDEO_POST_NSID, NOW]);
  const { poller } = makePoller({
    posts: [postView(uri(ALICE, 'due'), { likeCount: 500 })],
    profiles: [profileView(ALICE, { description: '#nobridge' })],
  });
  expect(await poller.runOnce()).toEqual({ checked: 1, qualified: 0, dropped: 3 });
  expect((await db.query('SELECT at_uri FROM posts ORDER BY at_uri')).map((r: any) => r.at_uri))
    .toEqual([native, uri(BOB, 'b')]);
});

test('an opt-out on getPosts counts before the next profile refresh', async () => {
  await bridged(ALICE, 'a');
  const { poller } = makePoller({
    posts: [postView(uri(ALICE, 'a'), {
      likeCount: 500, author: { labels: [lbl(profileUri(ALICE), '!no-unauthenticated', ALICE)] },
    })],
    profiles: [profileView(ALICE)],
  });
  expect(await poller.runOnce()).toMatchObject({ dropped: 1 });
});

test('authors are refreshed at most daily, and a removed profile self-label is deleted', async () => {
  await bridged(ALICE, 'a');
  const stub: AppViewStub = {
    posts: [postView(uri(ALICE, 'a'))],
    profiles: [profileView(ALICE, { labels: [lbl(profileUri(ALICE), 'spoiler', ALICE)] })],
  };
  // The AppView reports the profile self-label with the record's CID; it is
  // stored without one, so the next refresh can replace it.
  (stub.profiles[0].labels as any[])[0].cid = 'bafyprofile1';
  const first = makePoller(stub);
  await first.poller.runOnce();
  expect(first.calls.map((c) => c.method)).toEqual(['app.bsky.feed.getPosts', 'app.bsky.actor.getProfiles']);
  expect(await db.query('SELECT handle, display_name, followers_count FROM bridge_authors'))
    .toEqual([{ handle: 'alice.bsky.social', display_name: 'Alice', followers_count: 10 }]);

  // Due again, same day: no profile call.
  await db.query('UPDATE posts SET bridge_next_check_at = $1', [NOW]);
  const again = makePoller(stub);
  await again.poller.runOnce();
  expect(again.calls.map((c) => c.method)).toEqual(['app.bsky.feed.getPosts']);

  // A day later the profile is re-read, and the label it dropped goes.
  stub.profiles = [profileView(ALICE, { handle: 'handle.invalid' })];
  await db.query('UPDATE posts SET bridge_next_check_at = $1', [NOW]);
  const later = makePoller(stub, { now: () => new Date(NOW.getTime() + 25 * HOUR) });
  await later.poller.runOnce();
  expect(await db.query('SELECT val FROM labels WHERE subject = $1', [profileUri(ALICE)])).toEqual([]);
  expect((await db.query('SELECT handle FROM bridge_authors'))[0]).toEqual({ handle: null });
});

test('an author the AppView does not return counts as read, and keeps what is stored', async () => {
  await bridged(ALICE, 'a');
  await bridged(BOB, 'b');
  await db.query(
    `INSERT INTO bridge_authors (did, handle, followers_count, refreshed_at) VALUES ($1, 'bob.test', 7000, $2)`,
    [BOB, new Date(NOW.getTime() - 25 * HOUR)]);
  // Neither profile comes back: ALICE was never read, BOB's row is a day old.
  const stub: AppViewStub = { posts: [postView(uri(ALICE, 'a')), postView(uri(BOB, 'b'))], profiles: [] };
  const first = makePoller(stub);
  expect(await first.poller.runOnce()).toEqual({ checked: 2, qualified: 1, dropped: 0 });
  expect(await db.query('SELECT did, handle, followers_count, refreshed_at FROM bridge_authors ORDER BY did')).toEqual([
    { did: ALICE, handle: null, followers_count: null, refreshed_at: NOW },
    { did: BOB, handle: 'bob.test', followers_count: 7000, refreshed_at: NOW },
  ]);

  // Due again the same day: neither is asked for again.
  await db.query('UPDATE posts SET bridge_next_check_at = $1', [NOW]);
  const again = makePoller(stub);
  await again.poller.runOnce();
  expect(again.calls.map((c) => c.method)).toEqual(['app.bsky.feed.getPosts']);
});

test('an AppView error throws and leaves the batch due', async () => {
  await bridged(ALICE, 'a');
  const { poller } = makePoller({ posts: [], profiles: [], status: 429 });
  await expect(poller.runOnce()).rejects.toThrow('app.bsky.feed.getPosts returned 429');
  expect(await row(uri(ALICE, 'a'))).toMatchObject({ bridge_checked_at: null, bridge_next_check_at: new Date(NOW.getTime() - HOUR) });
});

test('a reply without the list throws, rather than passing for an empty one', async () => {
  await bridged(ALICE, 'a');
  // A 200 whose body isn't the method's: read as "no posts", it would delete
  // the row as gone, and mark its author read for the day.
  const poller = new Poller({
    fetch: (async () => Response.json({ message: 'try later' })) as typeof globalThis.fetch,
    now: () => NOW,
    thresholds: { minLikes: 50, minReposts: 10, minFollowers: 5000, qualifyDays: 7 },
  });
  await expect(poller.runOnce()).rejects.toThrow('app.bsky.feed.getPosts returned no posts list');
  expect(await row(uri(ALICE, 'a'))).toMatchObject({ bridge_checked_at: null });
  expect(await db.query('SELECT did FROM bridge_authors')).toEqual([]);
});

test('refuses a post lifetime shorter than the time a post has to qualify', () => {
  expect(() => makePoller({ posts: [], profiles: [] }, { recheckDays: 5 }))
    .toThrow('BRIDGE_RECHECK_DAYS (5) is less than BRIDGE_QUALIFY_DAYS (7)');
});

test('takes at most 25 due posts, longest-due first, and skips ones not due', async () => {
  // p00 is due last, p29 first.
  for (let i = 0; i < 30; i++) await bridged(ALICE, `p${String(i).padStart(2, '0')}`, HOUR, new Date(NOW.getTime() - (i + 1) * MIN));
  await db.query(`UPDATE posts SET bridge_next_check_at = $1 WHERE rkey = 'p29'`, [new Date(NOW.getTime() + MIN)]);
  const { poller, calls } = makePoller({ posts: [], profiles: [] });
  await poller.runOnce();
  const asked = calls.find((c) => c.method === 'app.bsky.feed.getPosts')!.params;
  expect(asked).toEqual(Array.from({ length: 25 }, (_, i) => uri(ALICE, `p${String(28 - i).padStart(2, '0')}`)));
});
