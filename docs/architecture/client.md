# Client (Expo / React Native)

What the tortok app does today: an Expo + React Native + TypeScript client for
iOS, Android and web, with a vertical video feed played over WebTorrent.
Present tense, tracking the code in `tortok/`; the *why* is in the
[decisions behind this](#decisions-behind-this). The P2P engine the feed uses
is documented in [p2p-torrent](p2p-torrent.md).

The client is mid-way through the Phase 3 move to atproto: login is atproto
OAuth, but the feed, likes and profile still call the legacy backend with a
JWT that OAuth login never provides. The consequences are listed under
[Implementation status](#implementation-status).

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

`patches/` holds one patch: `bittorrent-tracker`'s check for `ws://` trackers
read `window.location.protocol`, and React Native has no `window.location`
outside development builds, so any `ws://` tracker crashed a release build.
The patch reads it with optional chaining. `plugins/withDetoxAndroid.js` is a
local config plugin that adds Detox's Android test runner at `expo prebuild`.

## Navigation and session gating

Routes live in `tortok/app/`:

- `_layout.tsx` is the root. It loads fonts, calls the auth store's
  `hydrate()`, provides a TanStack `QueryClient`, and gates on the stored DID:
  while hydrating it renders nothing; with no DID outside `(auth)` it redirects
  to `/(auth)/login`; with a DID inside `(auth)` it redirects to `/(tabs)`. The
  gate uses `<Redirect>` so the redirect resolves before the stack mounts. In
  dev it also prefixes console output with elapsed time and drops `rn-webrtc:`
  debug lines.
- `(auth)/` holds `login` and `register` (a modal). `login` is the atproto
  sign-in screen. `register` is the legacy email/password sign-up form; nothing
  in the app links to it any more.
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

The Zustand auth store (`stores/auth.ts`) holds two identities side by side:

- `did` and `lastHandle`, set by `signInWithDid` after OAuth. The DID is
  what the root layout gates on. `lastHandle` survives sign-out so the login
  field is pre-filled.
- `token` and `user`, the legacy backend JWT and user record, set only by the
  legacy `signIn(token, user)`, which only the unreachable `register` screen
  calls.

The store persists to `expo-secure-store` on native and to `localStorage` on
web. `hydrate()` restores all four values and warms the OAuth session without
awaiting it. `signOut()` revokes the OAuth session (errors are swallowed) and
clears the DID, token and user.

## API client

`lib/api.ts` talks to the legacy backend (described in
[backend](backend.md#http-surface)). The base URL is chosen once at startup:
`EXPO_PUBLIC_API_URL` if set; otherwise in dev the Metro host's address on port
8080 (so simulators, emulators and LAN devices reach the dev machine), falling
back to `localhost:8080`; otherwise `https://tortok-api.fly.dev`. The value is
fixed at build time.

It wraps `fetch` with JSON bodies and an optional `Bearer` token, and
distinguishes `APIError` (the server answered with an error status) from
`NetworkError` (the request never completed). Exported calls: `login`,
`register`, `getFeed` (`/videos/feed`, `limit=10`, cursor sent as `offset`),
`likeVideo`, `recordView` and `getProfile`. Nothing in the app calls
`recordView` or `getProfile`, and `login` has no caller since the login screen
moved to OAuth.

## Feed and player

The feed (`app/(tabs)/index.tsx`) is a vertical, paged `FlatList`: each item
is exactly the measured height of the feed area, with snapping (one item per
swipe however fast, via `disableIntervalMomentum`) and
`viewAreaCoveragePercentThreshold: 50` deciding the active item. On web the
column is held to a 9:16 phone width, and a mouse drag of more than 50 px moves
one item up or down.

The feed query is `useQuery(['feed', token], () => getFeed(token))`. The
feed endpoint is public, so it runs with or without a legacy token. It loads
the first page only; there is no pagination in the UI.

Each `VideoItem` runs a small display state machine: `idle` (poster shown),
`loading` (poster shown, player buffering), `playing`, `paused`, `error` (with
a Retry button) and `empty` (no poster and no magnet). Only the active item
resolves a playback URL through `useP2PUrl(magnetLink, torrentFileUrl)`. On
native it returns a local URL served from the torrent by the WebTorrent bridge
(see [p2p-torrent](p2p-torrent.md#torrent-engine)). On web it skips WebTorrent
and returns the magnet's first webseed (`ws=`) URL, so web playback is plain
HTTP from the content origin with no P2P. Each item creates one
`expo-video` player at mount and swaps sources with `replaceAsync`, avoiding a
native player construction on every scroll. Players loop, unmuted; tapping the
video toggles pause; leaving the item pauses it and returns it to `idle`.

Around the active item, `usePrefetch(videos, activeIndex)` holds the torrents
of the items directly before and after it and fetches their first 512 KB
through the bridge, `useSeedPolicy(activeVideo)` applies the client seeding
policy, and posters for items −2 to +2 are prefetched into `expo-image`'s
memory-and-disk cache. On web the bridge is a stub that rejects, so prefetch
yields no URL there.

The overlay shows `@username`, the caption, hashtags, and three actions. Like
is optimistic with rollback on failure and does nothing without a legacy token.
Comment and Share have no handlers. The item logs a per-video timing line
(activate → `replaceAsync` → ready → playing) and the first-frame time, for
playback profiling.

## Profile

`app/(tabs)/profile.tsx` shows the signed-in handle and DID from the auth
store, with the sign-out button. When a legacy `user` is also present it adds
that user's display name, bio and follower/following/video counts. It has no
grid of the user's own videos; the author feed that would fill one isn't
built.

## Testing

`stores/auth.test.ts` holds Jest unit tests for the auth store, run with
`npx jest --config stores/jest.config.js` from `tortok/` (there is no `test`
script).

`tortok/e2e/` holds the Detox suite (`auth`, `feed`, `navigation`, `profile`,
`session`), which runs on the iOS simulator and the Android emulator against
release builds ([Decision 0021](decisions/0021-e2e-on-hosted-runners.md)). It
covers sign-in, the feed loading the five test clips, playback reaching
`playing`, pause and resume on tap, swiping to the next clip and back, the
three tabs, the profile's handle and DID, session persistence across a
relaunch, and sign-out.

- **Stack:** `scripts/e2e-up.sh` starts what the app talks to, on the host: a
  throwaway PLC and PDS with a test account (`test-network/start.mjs`), the
  backend on its own `tortok_e2e` database, the tracker, and the content
  server, then seeds the legacy feed. `scripts/e2e-down.sh` stops it. On
  Android the tests reverse the stack's ports to the emulator.
- **Sign-in:** e2e builds are bundled with `EXPO_PUBLIC_E2E=1`, which adds a
  test sign-in form to the login screen (`lib/atproto/devSignIn.ts`): an app
  password against the test PDS. User builds never set the flag, and the real
  OAuth flow isn't driven by the suite.
- **Test hooks:** the active feed item carries `activeVideoState` (its display
  state as an accessibility label), `activeVideoAuthor` and
  `activeVideoCaption`; the feed list is `videoFeed`, and the tabs are
  `homeTab`, `recordTab` and `profileTab`.
- **Running it:** `npm run e2e:build:ios` then `npm run e2e:test:ios` (or the
  `android` pair) from `tortok/`, after `npx expo prebuild` and with the stack
  up. CI runs both platforms on every pull request
  (`.github/workflows/e2e.yml`).

## Implementation status

- **Built:** Expo app on iOS, Android and web; atproto OAuth login with session
  restore and revocation; the paged feed with the poster/player state machine;
  WebTorrent playback, prefetch and seeding policy on native (Phase 2, see
  [p2p-torrent](p2p-torrent.md)). Web plays from the webseed over HTTP only.
- **Still on the legacy backend:** the feed reads the legacy `/videos/feed`,
  and Like does nothing without a legacy token, which OAuth sign-in never
  creates. Phase 3 Unit 2.5B moves the feed onto atproto records and Unit 2.5C
  retires the legacy token, `user`, `register` and the legacy API calls
  ([`phase-3-atproto.md`](../plans/phase-3-atproto.md)).
- **Not built: recording and upload.** The Record tab is a placeholder, out of
  scope for v1. When recording is built, it must take `CAMERA` and
  `RECORD_AUDIO` back out of `android.blockedPermissions` in `app.json`, and
  replace the iOS usage strings with ones that describe recording.
- **Not built, other:** publishing records to the PDS (Phase 3 Unit 3), comments,
  sharing, feed pagination, view reporting (`recordView` is unused), choosing an
  AppView at runtime (Decision 0017; the backend URL is fixed at build time),
  and web cookie auth (Phase 3 Unit 7; web tokens sit in `localStorage` today).
- **Placeholder identity:** the bundle identifier and package are still
  `com.anonymous.tortok`.

## Decisions behind this

- [Decision 0004 — Client is Expo + React Native + TypeScript](decisions/0004-client-expo-react-native.md)
- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md) and [Decision 0019 — v1 uses each user's existing PDS through atproto OAuth](decisions/0019-v1-uses-existing-pds-via-oauth.md) — login is atproto OAuth against the user's existing PDS.
- [Decision 0009 — Client seeding policy](decisions/0009-client-seeding-policy.md) — what the feed seeds back, via `useSeedPolicy`.
- [Decision 0016 — Testing strategy](decisions/0016-testing-strategy-where-each-kind-of-test-lives.md) — targeted client unit tests; Detox as the start of tier 1.
- [Decision 0017 — The AppView's Postgres is a rebuildable index](decisions/0017-appview-postgres-is-a-rebuildable-index.md) — the client must choose its AppView at runtime.
- [Decision 0021 — End-to-end tests run on GitHub-hosted runners](decisions/0021-e2e-on-hosted-runners.md) — Detox on both platforms in CI, against a throwaway stack with its own PDS.
