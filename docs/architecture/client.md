# Client (Expo / React Native)

What the tortok app does today: an Expo + React Native + TypeScript client for
iOS, Android and web, with a vertical video feed played over WebTorrent.
Present tense, tracking the code in `tortok/`; the *why* is in the
[decisions behind this](#decisions-behind-this). The P2P engine the feed uses
is documented in [p2p-torrent](p2p-torrent.md).

The client is an atproto client: login is atproto OAuth against the user's own
PDS, and the feed shows `app.tortok.video.post` records the AppView has
indexed. It has no legacy email/password path.

## Stack and build

Expo SDK 54 with React Native 0.81 and React 19.1, the New Architecture
enabled (`app.json`), and Expo Router 6 with typed routes (entry
`expo-router/entry`). Video plays through **`expo-video`** (`useVideoPlayer` /
`VideoView`), not react-native-video. Server state goes through TanStack Query
5, and client state through Zustand 5.

`app.json` sets the URL scheme `app.tortok` (used as the OAuth redirect), an iOS
deployment target of 26.3, Android cleartext traffic (for the local dev
backend), and the `react-native-webrtc` config plugin. P2P uses WebRTC data
channels only, so the app needs no camera, microphone or related access. The
plugin adds `CAMERA`, `RECORD_AUDIO`, `BLUETOOTH`, `SYSTEM_ALERT_WINDOW` and
`MODIFY_AUDIO_SETTINGS` to the Android manifest unconditionally, so `app.json`
lists all five under `android.blockedPermissions`, which strips them from the
merged manifest. On iOS the plugin's camera and microphone usage strings stay:
the WebRTC library references those APIs, and Apple rejects binaries that do
without purpose strings. The app never requests either permission. The bundle
identifier and Android package are
still the template's `com.anonymous.tortok`. Web builds with Metro to static
output.

`package.json` scripts: `start`, `ios` and `android` (`expo run:*`; `android`
first runs `adb:ports`, which reverses ports 8080 and 8090 to the host), `web`,
the Detox scripts `e2e:build:ios`, `e2e:test:ios`, `e2e:build:android` and
`e2e:test:android`, and `postinstall`, which runs `patch-package`.

`patches/` holds two patches. `bittorrent-tracker`'s check for `ws://` trackers
read `window.location.protocol`, and React Native has no `window.location`
outside development builds, so any `ws://` tracker crashed a release build;
the patch reads it with optional chaining. `expo-video`'s Android HTTP client
is patched to reach loopback addresses without a proxy, and `package.json`'s
`expo.autolinking.android.buildFromSource` makes the build compile that
module so the patch applies ([p2p-torrent](p2p-torrent.md#torrent-engine));
the Android e2e job fails if the compiled module lacks it. Compiling leaves
build output inside `node_modules/expo-video`, so remake the patch with
`npx patch-package expo-video --exclude '^(package\.json|android/build/.*)$'`.
`plugins/withDetoxAndroid.js` is a
local config plugin that adds Detox's Android test runner at `expo prebuild`.
`plugins/withQuietDependencyWarnings.js` silences compiler warnings from
dependencies' native code: `inhibit_all_warnings!` for every pod, and
suppressed Kotlin, Java and C/C++ warnings for every Android module except
`app`. The app's own native code still warns. About 580 iOS warnings remain
(umbrella headers, libtool, nullability, Hermes), left for the SDK 55
upgrade. Prebuilding with `TORTOK_NATIVE_WARNINGS=1` removes the plugin's
blocks and brings every warning back.

## Navigation and session gating

Routes live in `tortok/app/`:

- `_layout.tsx` is the root. It loads fonts, calls the auth store's
  `hydrate()`, provides a TanStack `QueryClient`, and gates on the stored DID:
  while hydrating it renders nothing; with no DID outside `(auth)` it redirects
  to `/(auth)/login`; with a DID inside `(auth)` it redirects to `/(tabs)`. A
  perf build ([Testing](#testing)) skips the first redirect and shows the tabs
  with nobody signed in. The
  gate uses `<Redirect>` so the redirect resolves before the stack mounts. In
  dev it also prefixes console output with elapsed time and drops `rn-webrtc:`
  debug lines.
- `(auth)/` holds `login`, the atproto sign-in screen. Accounts are created
  and recovered on the user's PDS, not in the app.
- `(tabs)/` holds three tabs: **Home** (`index`, the feed), **Record**
  (`record`, a "Coming soon" placeholder), and **Profile** (`profile`).
- `+not-found.tsx` links back home; `+html.tsx` is the web document shell,
  which installs `process.nextTick` and `process.cwd` shims for WebTorrent in
  the browser.

`app/_layout.tsx` imports `lib/polyfills.ts` first. It adds
`AbortSignal.timeout` and `AbortSignal.prototype.throwIfAborted`, which the
atproto OAuth client needs on Hermes. The WebTorrent-only polyfills are
separate and described in [p2p-torrent](p2p-torrent.md#torrent-engine).

## Authentication

Login is atproto OAuth (PAR + DPoP) against the user's own PDS, through
`@atproto/oauth-client-expo` (`lib/atproto/oauth.ts`). The user enters a
Bluesky handle; the client resolves it via `https://bsky.social`, opens the
system auth browser, and receives the redirect at `app.tortok:/auth/callback`.
The OAuth client keeps its sessions and DPoP keys in its own MMKV store.

The client metadata is bundled at `tortok/assets/oauth-client-metadata.json`
and must match the hosted `client_id` document,
`https://tortok.app/.well-known/oauth-client-metadata.json`, whose source is
`web/public/.well-known/`. The three were identical when checked on
2026-11-09. It requests scope `atproto transition:generic` and registers two
redirect URIs (the app scheme and `https://tortok.app/auth/callback`).

The Zustand auth store (`stores/auth.ts`) holds `did` and `lastHandle`, set
by `signInWithDid` after OAuth. The DID is what the root layout gates on.
`lastHandle` survives sign-out so the login field is pre-filled.

The store persists to `expo-secure-store` on native and to `localStorage` on
web. `hydrate()` restores both values and warms the OAuth session without
awaiting it. `signOut()` revokes the OAuth session (errors
are swallowed) and clears the DID.

## API client

`lib/api.ts` talks to the AppView (described in
[backend](backend.md#http-surface)). Which AppView is the user's choice, held
in `stores/appview.ts`; callers pass it to each request, and the feed's query
key includes it. Until the user picks one, the
build's default applies: `EXPO_PUBLIC_API_URL` if the build sets it (the e2e
builds do); otherwise in dev the Metro host's address on port 8080 (so
simulators, emulators and LAN devices reach the dev machine); otherwise
tortok's AppView, `https://appview.tortok.app`.

It makes unauthenticated GETs, since the AppView's API is read-only, and
distinguishes `APIError` (the server answered with an error status) from
`NetworkError` (the request never completed). Its one call is `getFeed`
(`/videos/feed`, `limit=10`, cursor sent as `offset`). `Video` is the feed item
([backend](backend.md#videos-and-feed)): an AT-URI `id`, an `author` whose
`handle` is `null` unless it verified, and a `playback` of one of two kinds:
`torrent` (the magnet, the `.torrent` URL and the AppView's extra `sources`)
for native posts, or `hls` (a playlist URL) for posts bridged from Bluesky
(Decision 0010). `torrentOf()` and `hlsUrlOf()` pick them out;
`blueskyPostUrl()` gives a bridged post's bsky.app page from its AT-URI.
`authorLabel()` shows `@handle`, else the display name, else the DID.

## Feed and player

The feed (`app/(tabs)/index.tsx`) is a vertical, paged `FlatList`: each item
is exactly the measured height of the feed area, with snapping (one item per
swipe however fast, via `disableIntervalMomentum`) and
`viewAreaCoveragePercentThreshold: 50` deciding the active item. On web the
column is held to a 9:16 phone width, and a mouse drag of more than 50 px moves
one item up or down.

The feed query is `useQuery(['feed'], () => getFeed())`: the feed is public
and needs no session. It loads the first page only; there is no pagination
in the UI. When the load fails the screen says so and the log says why.

Each `VideoItem` runs a small display state machine: `idle` (poster shown),
`loading` (poster shown, player buffering), `playing`, `paused`, `error` (with
a Retry button). Only the active item
resolves a playback URL, through `usePlaybackUrl(video, isActive)`, which
switches on the playback kind. A bridged post's is its HLS playlist, played
as it is over plain HTTP with no P2P. A native post's comes from
`useP2PUrl(playback)`, keyed by the magnet.
On native it returns a local URL served from the torrent by the WebTorrent
bridge (see [p2p-torrent](p2p-torrent.md#torrent-engine)); the torrent is
added with the AppView's extra trackers and webseeds. On web it skips
WebTorrent and returns the magnet's first webseed (`ws=`), else the first
extra webseed, so web playback is plain HTTP with no P2P. Each item creates one
`expo-video` player at mount and swaps sources with `replaceAsync`, avoiding a
native player construction on every scroll. Players loop, unmuted; tapping the
video toggles pause; leaving the item pauses it and returns it to `idle`.

On Android a native post's source is given to the player with `useCaching`.
The player buffers 50 s ahead and loops, and with no cache it fetched a 20 s
clip from the bridge four times before the first loop ended and once for each
loop after; with the cache it fetches it once. Each fetch passes through the
JavaScript thread ([p2p-torrent](p2p-torrent.md#torrent-engine)). The cache
is keyed by the bridge's URL, whose port changes with every launch, so the
root layout clears it at launch, before any player exists. iOS, whose player
loops by seeking and whose cache loads differently, hasn't been measured and
doesn't cache.

Around the active item, `usePrefetch(videos, activeIndex)` holds the torrents
of the items directly before and after it and reads their first 512 KB
from the torrent, `useSeedPolicy(activeVideo)` applies the client seeding
policy, and posters for items −2 to +2 are prefetched into `expo-image`'s
memory-and-disk cache. On web the bridge is a stub that rejects, so prefetch
yields no URL there.

The overlay shows the author (`authorLabel`), the caption and hashtags, and
for a bridged post a "via Bluesky" badge that opens the post on bsky.app. It
has no action buttons: Phase 3 ships no likes, comments or sharing.

**Watch history** (`lib/watchHistory.ts`) is a log of view events, one per
stint as the active item: the post, when, time watched (pauses and seeks
excluded), loops, whether it completed, the video's duration and the post's
hashtags, read from the player's time updates. A skip (left within 2 s
without finishing) and per-post totals are derived from it (`statsFor`). It
is a log rather than totals because ranking's modes and explanations need
each view's time ([`feed-ranking.md`](open-problems/feed-ranking.md)). It is
kept in MMKV on the device, capped at 20,000 events (each new one past that
drops the oldest), and never sent anywhere; nothing reads it yet.

**Playback record** (`lib/playbackTrace.ts`). Each stint as the active item
also ends with one log line, `[playback]` and a JSON record: the post, its
playback kind, and the time from becoming active to a playback URL, to the
player being ready, to the poster giving way and to the first frame
(`onFirstFrameRender`); then how long it was active, the media time played,
each stall (the player buffering once the video was showing) and its length,
the longest the app was held up (how late a 250 ms timer fired, which the
JavaScript thread or the main thread can cause), and the player's error if
it failed. The record ends when the item is left or the app leaves the
foreground, whichever comes first. Every build logs it, and nothing is sent
anywhere. `scripts/playback-report.mjs` reads the records
from a device log ([Testing](#testing)).

## Profile

`app/(tabs)/profile.tsx` shows the signed-in handle and DID from the auth
store, with the sign-out button. It doesn't fetch the atproto profile (display
name, avatar, bio).

Below them, the **AppView setting** shows the AppView in use and lets the user
enter another: an origin with no path. Release builds take only `https`, apart
from the build's own default; development and e2e builds also take `http`.
Before it's saved, the address must serve a feed (`GET /videos/feed?limit=1`
answers with a `videos` array); otherwise the screen shows why and keeps the
current one. The choice persists in MMKV (it isn't secret), read synchronously
when the store is created, and "Use the default" forgets it. Since the feed's
query is keyed by the AppView, a change loads the new AppView's feed. The
screen has no
grid of the user's own videos; the author feed that would fill one isn't
built.

## Testing

`stores/auth.test.ts`, `stores/appview.test.ts`,
`lib/watchHistory.test.ts`, `lib/playbackTrace.test.ts`,
`lib/perfBuild.test.ts` and `lib/webtorrent/bridge.native.test.ts` hold Jest
unit tests for the auth and AppView stores, the watch history, the playback
record, the perf build's feed and the bridge's read-ahead
(MMKV is replaced by `__mocks__/react-native-mmkv.ts`), run with
`npm test` from `tortok/`, which runs every `*.test.ts(x)` outside `e2e/`
(`jest.config.js`). CI runs them with
the app's typecheck (`.github/workflows/ci.yml`, job `client`).

`tortok/e2e/` holds the Detox suite (`auth`, `feed`, `navigation`, `profile`,
`session`), which runs on the iOS simulator and the Android emulator against
release builds ([Decision 0021](decisions/0021-e2e-on-hosted-runners.md)). It
covers sign-in, the feed loading the five test clips, playback reaching
`playing`, pause and resume on tap, swiping to the next clip and back,
reaching the bridged post (badged, playing over HLS), the
three tabs, the profile's handle and DID, session persistence across a
relaunch, and sign-out.

- **Stack:** `scripts/e2e-up.sh` starts what the app talks to, on the host: a
  throwaway PLC and PDS with a test account (`test-network/start.mjs`), the
  tracker, and the content server; publishes the five test clips as
  `app.tortok.video.post` records to the test PDS (`scripts/seed-fixtures.mjs`,
  with local webseeds and tracker); then starts the backend on its own
  `tortok_e2e` database, whose ingest indexes them by backfilling the test
  account. The test handle can't verify, so the feed shows its profile's
  display name. It also inserts one qualified bridged Bluesky post, oldest
  so it's last, whose playlist and thumbnail the content server serves from
  `test-content/hls/` (built by `make-hls-fixture.sh`) in place of
  Bluesky's video service, through the backend's `BRIDGE_VIDEO_BASE`.
  `scripts/e2e-down.sh` stops it. On
  Android the tests reverse the stack's ports to the emulator.
- **Sign-in:** e2e builds are bundled with `EXPO_PUBLIC_E2E=1`, which adds a
  test sign-in form to the login screen (`lib/atproto/devSignIn.ts`): an app
  password against the test PDS. User builds never set the flag, and the real
  OAuth flow isn't driven by the suite.
- **Test hooks:** the active feed item carries `activeVideoState` (its display
  state as an accessibility label), `activeVideoAuthor`,
  `activeVideoCaption` and, on a bridged post, `activeVideoBlueskyBadge`; the feed list is `videoFeed`, and the tabs are
  `homeTab`, `recordTab` and `profileTab`.
- **Running it:** `npm run e2e:build:ios` then `npm run e2e:test:ios` (or the
  `android` pair) from `tortok/`, after `npx expo prebuild` and with the stack
  up. CI runs both platforms on every pull request that changes code,
  slimming the iOS simulator first with `simslim` to fit the runner's 7 GB
  (`.github/workflows/e2e.yml`). Running the stack locally needs `npm ci` in
  the repo root, `backend/`, `test-content/` and `test-network/`.
- **Flakes and logs:** on the hosted iOS simulator a tap sometimes never
  reaches the app (the app logs no state change), so `tapVideoUntil()` in
  `e2e/helpers.ts` resends it, and CI logs say `tapping again` when it does.
  A release build's JS logs are in Detox's `device.log` artifact under
  `com.facebook.react.log`, kept for failing tests only.

**Playback on real phones** is measured by hand with a perf build, on phones
rented by the session ([the spike](decisions/spikes/does-the-feed-start-quickly-and-play-smoothly-on-real-android-phones.md)
holds the method and the results):

- **The build:** `npm run perf:apk` (`scripts/perf-apk.sh`) makes an arm64
  release APK bundled with `EXPO_PUBLIC_PERF=1` (`lib/perfBuild.ts`). Nobody
  can sign in on a rented phone, so the build opens the feed signed out;
  Profile then reads "Not signed in". Its feed is the 30 newest posts with
  the posts named in `EXPO_PUBLIC_PERF_PINS` mixed in, one after every second
  post, each fetched by `GET /videos/:id`; a pin the AppView doesn't have
  fails the load. The script pins production's five test clips, because the
  newest posts there are all bridged, and reads production's AppView unless
  `PERF_APPVIEW` names another. It sets every `EXPO_PUBLIC_*` value it
  depends on, since Expo also reads a developer's `tortok/.env.local` when it
  bundles, and it makes the bundle afresh from its own Metro cache, since
  neither Gradle nor Metro treats those values as an input. User builds never
  set the flag. `.github/workflows/perf-apk.yml` runs the same script on
  demand and keeps the APK as an artifact.
- **The figures:** `npm run playback:report -- <device log>...`
  (`scripts/playback-report.mjs`) reads the `[playback]` records out of
  `adb logcat` output or a rental's log download. For each log and playback
  kind it prints how many videos started, the median, 90th-percentile and
  longest start, how many stalled and what share of playing time the stalls
  took, the share of the time after starting in which the video's position
  didn't advance (a check on the stalls the player reports, which also
  counts pauses), how many were given up on (left unstarted after 5 seconds
  or more), errors, and the longest hold-up; `--each` lists every video. A
  start is the later of the poster giving way and the first frame. Its tests
  (`scripts/playback-report.test.mjs`) run in CI with the smoke check's.
- **What it can't show:** dropped video frames, which the player doesn't
  report, and peers on home networks.

## Implementation status

- **Built:** Expo app on iOS, Android and web; atproto OAuth login with session
  restore and revocation; an in-app AppView URL setting; the paged feed with the poster/player state machine;
  WebTorrent playback, prefetch and seeding policy on native (Phase 2, see
  [p2p-torrent](p2p-torrent.md)). Web plays from the webseed over HTTP only.
- **Not built: recording and upload.** The Record tab is a placeholder, out of
  scope for v1. When recording is built, it must take `CAMERA` and
  `RECORD_AUDIO` back out of `android.blockedPermissions` in `app.json`, and
  replace the iOS usage strings with ones that describe recording.
- **Not built, other:** publishing records to the PDS (Phase 3 Unit 3), comments,
  likes, sharing, feed pagination, view reporting, finding an AppView
  through a service DID and PDS proxying (the setting takes a URL; decision 4
  in [`phase-3-atproto.md`](../plans/phase-3-atproto.md)), and web cookie auth (Phase 3 Unit 7; web tokens sit in `localStorage` today).
- **Placeholder identity:** the bundle identifier and package are still
  `com.anonymous.tortok`.

## Decisions behind this

- [Decision 0004 — Client is Expo + React Native + TypeScript](decisions/0004-client-expo-react-native.md)
- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md) and [Decision 0019 — v1 uses each user's existing PDS through atproto OAuth](decisions/0019-v1-uses-existing-pds-via-oauth.md) — login is atproto OAuth against the user's existing PDS.
- [Decision 0009 — Client seeding policy](decisions/0009-client-seeding-policy.md) — what the feed seeds back, via `useSeedPolicy`.
- [Decision 0016 — Testing strategy](decisions/0016-testing-strategy-where-each-kind-of-test-lives.md) — targeted client unit tests; Detox as the start of tier 1.
- [Decision 0017 — The AppView's Postgres is a rebuildable index](decisions/0017-appview-postgres-is-a-rebuildable-index.md) — the client must choose its AppView at runtime.
- [Decision 0021 — End-to-end tests run on GitHub-hosted runners](decisions/0021-e2e-on-hosted-runners.md) — Detox on both platforms in CI, against a throwaway stack with its own PDS.
