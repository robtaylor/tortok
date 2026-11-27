// A build for measuring playback on real devices, where nobody can sign in
// (docs/architecture/client.md, Testing). Bundled with EXPO_PUBLIC_PERF=1,
// which Expo inlines at build time, the app opens the feed without a session
// and loads a longer first page, with the posts named in
// EXPO_PUBLIC_PERF_PINS (AT-URIs, comma-separated) mixed into it: native
// posts are too rare among the newest posts to be measured otherwise.
// User builds never set either.

import { getFeed, getVideo, type FeedResponse, type Video } from '@/lib/api';

export const PERF_BUILD = process.env.EXPO_PUBLIC_PERF === '1';

const PINS = (process.env.EXPO_PUBLIC_PERF_PINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Feed items a perf build loads. */
const PAGE = 30;
/** A pinned post follows every this many feed items. */
const EVERY = 2;

/** The feed's items with a pinned post after every EVERY of them; pins left over go last. */
export function mixIn(pinned: Video[], feed: Video[]): Video[] {
  const pins = new Set(pinned.map((v) => v.id));
  const queue = [...pinned];
  const mixed = feed
    .filter((v) => !pins.has(v.id))
    .flatMap((v, i) => ((i + 1) % EVERY === 0 ? [v, ...queue.splice(0, 1)] : [v]));
  return [...mixed, ...queue];
}

/** The feed a perf build shows. A pin the AppView doesn't have fails the load: the build was made to measure it. */
export async function perfFeed(appView: string): Promise<FeedResponse> {
  const [feed, pinned] = await Promise.all([
    getFeed(appView, undefined, PAGE),
    Promise.all(PINS.map((uri) => getVideo(appView, uri))),
  ]);
  return { ...feed, videos: mixIn(pinned, feed.videos) };
}
