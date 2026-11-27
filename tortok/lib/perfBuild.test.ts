// Unit tests for the perf build's feed: where pinned posts go, and what it
// asks the AppView for. Run with `npm test`.

import type { Video } from './api';

type PerfBuild = typeof import('./perfBuild');

/** Load the module as a build with these settings would have it. */
function load(env: { perf?: string; pins?: string } = {}): PerfBuild {
  jest.resetModules();
  process.env.EXPO_PUBLIC_PERF = env.perf ?? '';
  process.env.EXPO_PUBLIC_PERF_PINS = env.pins ?? '';
  return require('./perfBuild') as PerfBuild;
}

const video = (id: string) => ({ id }) as Video;
const ids = (videos: Video[]) => videos.map((v) => v.id);

const APPVIEW = 'https://appview.example.com';
const PIN_A = 'at://did:plc:a/app.tortok.video.post/1';
const PIN_B = 'at://did:plc:a/app.tortok.video.post/2';

/** An AppView serving a feed of `feed` and the posts in `posts`; returns the paths asked for. */
function appView(feed: string[], posts: string[]): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const path = url.slice(APPVIEW.length);
    asked.push(path);
    if (path.startsWith('/videos/feed')) {
      return { ok: true, status: 200, json: async () => ({ videos: feed.map(video), nextCursor: null, hasMore: false }) };
    }
    const id = decodeURIComponent(path.slice('/videos/'.length));
    return posts.includes(id)
      ? { ok: true, status: 200, json: async () => video(id) }
      : { ok: false, status: 404, json: async () => ({ error: 'Video not found' }) };
  }) as unknown as typeof fetch;
  return asked;
}

test('only EXPO_PUBLIC_PERF=1 makes a perf build', () => {
  expect(load().PERF_BUILD).toBe(false);
  expect(load({ perf: 'true' }).PERF_BUILD).toBe(false);
  expect(load({ perf: '1' }).PERF_BUILD).toBe(true);
});

describe('mixIn', () => {
  const { mixIn } = load();

  test('puts a pinned post after every second feed item', () => {
    expect(ids(mixIn([video('p1'), video('p2')], ['a', 'b', 'c', 'd', 'e'].map(video))))
      .toEqual(['a', 'b', 'p1', 'c', 'd', 'p2', 'e']);
  });

  test('pins the feed has no room for go last', () => {
    expect(ids(mixIn(['p1', 'p2', 'p3'].map(video), ['a', 'b', 'c'].map(video))))
      .toEqual(['a', 'b', 'p1', 'c', 'p2', 'p3']);
    expect(ids(mixIn([video('p1')], []))).toEqual(['p1']);
  });

  test('a pinned post already in the feed appears once, where it is pinned', () => {
    expect(ids(mixIn([video('p1')], ['p1', 'a', 'b', 'c'].map(video)))).toEqual(['a', 'b', 'p1', 'c']);
  });

  test('with nothing pinned the feed is unchanged', () => {
    expect(ids(mixIn([], ['a', 'b', 'c'].map(video)))).toEqual(['a', 'b', 'c']);
  });
});

describe('perfFeed', () => {
  test('loads a longer page and each pinned post, and mixes them', async () => {
    const asked = appView(['a', 'b', 'c'], [PIN_A, PIN_B]);
    const { perfFeed } = load({ perf: '1', pins: ` ${PIN_A},${PIN_B}, ` });
    expect(ids((await perfFeed(APPVIEW)).videos)).toEqual(['a', 'b', PIN_A, 'c', PIN_B]);
    expect(asked.sort()).toEqual([
      `/videos/${encodeURIComponent(PIN_A)}`,
      `/videos/${encodeURIComponent(PIN_B)}`,
      '/videos/feed?limit=30',
    ]);
  });

  test("fails when the AppView doesn't have a pinned post", async () => {
    appView(['a'], [PIN_A]);
    const { perfFeed } = load({ perf: '1', pins: `${PIN_A},${PIN_B}` });
    await expect(perfFeed(APPVIEW)).rejects.toThrow('Video not found');
  });
});
