// The bridge's engagement poller (plan 2.5D step 18, Decision 0023): labels
// stored, NSFW/gone/opted-out rows dropped, thresholds, the 7-day cutoff and
// the decaying schedule. Against a real Postgres (Decision 0016); Bluesky's
// AppView is stubbed.

import { createTestDb, TestDb } from './helpers/testDb';
// Type-only and db-free imports here: anything that loads ../db must wait
// for createTestDb() (below), or its pool connects to the dev database.
import type { BskyEngagementPoller as PollerT, PollerOptions } from '../services/bskyEngagementPoller';
import { accountSubjects } from '../atproto/labels';

const profileUri = (did: string) => accountSubjects(did)[1];

const NSID = 'app.bsky.feed.post';
const MOD = 'did:plc:ar7c4by46qjdydhdevvrndac';
const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = new Date('2026-11-12T12:00:00Z');
const HOUR = 3_600_000;
const MIN = 60_000;

const uri = (did: string, rkey: string) => `at://${did}/${NSID}/${rkey}`;

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

/** Insert a bridged row as the firehose would (due at once), `ageMs` old. */
async function bridged(did: string, rkey: string, ageMs = HOUR, dueAt = new Date(NOW.getTime() - ageMs)) {
  await db.query(
    `INSERT INTO posts (at_uri, did, collection, rkey, cid, video_cid, width, height, record_created_at, bridge_next_check_at)
     VALUES ($1, $2, $3, $4, 'bafyrec', 'bafyvid', 9, 16, $5, $6)`,
    [uri(did, rkey), did, NSID, rkey, new Date(NOW.getTime() - ageMs), dueAt]);
}

interface Stub {
  posts: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  status?: number;
}

/** An AppView stub; records the methods it was called with. */
function appview(stub: Stub) {
  const calls: { method: string; params: string[] }[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const method = url.pathname.replace('/xrpc/', '');
    const params = [...url.searchParams.values()];
    calls.push({ method, params });
    if (stub.status) return new Response('{}', { status: stub.status });
    if (method === 'app.bsky.feed.getPosts') {
      return Response.json({ posts: stub.posts.filter((p) => params.includes(p.uri as string)) });
    }
    return Response.json({ profiles: stub.profiles.filter((p) => params.includes(p.did as string)) });
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, calls };
}

const postView = (u: string, over: Record<string, unknown> = {}) => ({ uri: u, likeCount: 0, repostCount: 0, labels: [], author: { labels: [] }, ...over });
const profileView = (did: string, over: Record<string, unknown> = {}) => ({ did, handle: 'alice.bsky.social', displayName: 'Alice', followersCount: 10, labels: [], ...over });
const lbl = (u: string, val: string, src = MOD, extra: object = {}) => ({ src, uri: u, val, cts: '2026-11-12T11:00:00Z', ...extra });

function makePoller(stub: Stub, opts: PollerOptions = {}) {
  const { fetch, calls } = appview(stub);
  const poller = new Poller({
    fetch, now: () => NOW,
    thresholds: { minLikes: 50, minReposts: 10, minFollowers: 5000, qualifyDays: 7 },
    ...opts,
  });
  return { poller, calls };
}

const row = (u: string) => db.query<Record<string, any>>('SELECT * FROM posts WHERE at_uri = $1', [u]).then((r) => r[0]);

test('nextCheckDelayMs is half the age, between 15 minutes and a day', () => {
  expect(nextCheckDelayMs(0)).toBe(15 * MIN);
  expect(nextCheckDelayMs(4 * HOUR)).toBe(2 * HOUR);
  expect(nextCheckDelayMs(10 * 24 * HOUR)).toBe(24 * HOUR);
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
  await bridged(ALICE, 'old', 8 * 24 * HOUR);
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

test('a qualified post that ages past 7 days stays, on a daily schedule, until the recheck horizon', async () => {
  await bridged(ALICE, 'q', 10 * 24 * HOUR);
  await bridged(ALICE, 'old', 31 * 24 * HOUR);
  await db.query('UPDATE posts SET bridge_qualified_at = $1', [new Date(NOW.getTime() - 9 * 24 * HOUR)]);
  const { poller } = makePoller(
    { posts: [postView(uri(ALICE, 'q')), postView(uri(ALICE, 'old'))], profiles: [profileView(ALICE)] },
    { recheckDays: 30 });
  expect(await poller.runOnce()).toEqual({ checked: 2, qualified: 0, dropped: 0 });
  expect((await row(uri(ALICE, 'q'))).bridge_next_check_at).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  // Past 30 days: out of the queue, still served.
  expect(await row(uri(ALICE, 'old'))).toMatchObject({ bridge_next_check_at: null, bridge_checked_at: NOW });
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
  const stub: Stub = {
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

test('an AppView error throws and leaves the batch due', async () => {
  await bridged(ALICE, 'a');
  const { poller } = makePoller({ posts: [], profiles: [], status: 429 });
  await expect(poller.runOnce()).rejects.toThrow('app.bsky.feed.getPosts returned 429');
  expect(await row(uri(ALICE, 'a'))).toMatchObject({ bridge_checked_at: null, bridge_next_check_at: new Date(NOW.getTime() - HOUR) });
});

test('takes at most 25 due posts, longest-due first, and skips ones not due or out of the queue', async () => {
  // p00 is due last, p29 first.
  for (let i = 0; i < 30; i++) await bridged(ALICE, `p${String(i).padStart(2, '0')}`, HOUR, new Date(NOW.getTime() - (i + 1) * MIN));
  await db.query(`UPDATE posts SET bridge_next_check_at = $1 WHERE rkey = 'p29'`, [new Date(NOW.getTime() + MIN)]);
  await db.query(`UPDATE posts SET bridge_next_check_at = NULL WHERE rkey = 'p28'`);
  const { poller, calls } = makePoller({ posts: [], profiles: [] });
  await poller.runOnce();
  const asked = calls.find((c) => c.method === 'app.bsky.feed.getPosts')!.params;
  expect(asked).toEqual(Array.from({ length: 25 }, (_, i) => uri(ALICE, `p${27 - i}`.replace(/^p(\d)$/, 'p0$1'))));
});
