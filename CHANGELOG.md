# Changelog

All notable changes to tortok are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/). See `docs/release-process.md`
for how a release is cut.

## [Unreleased]

### What this means for you

<!--
A few benefit-framed bullets: what a user can now *do*, not what changed
internally. This block becomes the release intro, so write it for someone
deciding whether to upgrade.
-->

- <You can now …>

### Added

- The feed shows `app.tortok.video.post` records indexed from the network, not the legacy video table. Authors show as their verified handle, else their display name. Posters and `.torrent` files come from a new blob route, `GET /blob/:did/:cid`, which checks every blob against its CID and serves it as immutable, so Cloudflare can cache it for good (Phase 3 Unit 2.5B).
- Feed items list extra trackers (and, once mirrors exist, webseeds) that the app adds to each torrent, so new sources need no app release (Decision 0022).
- The backend indexes `app.tortok.video.post` records from the network: a Jetstream subscriber with a saved cursor, `listRecords` backfill of known accounts, record validation against the Lexicon, and authors resolved from their own DID documents and PDSes. New tables `posts`, `profiles`, `ingest_cursor` and `known_accounts`. The feed doesn't read them yet (Phase 3 Unit 2.5B).
- `scripts/seed-fixtures.mjs` (`npm run seed:fixtures`) publishes the five test clips as `app.tortok.video.post` records from the dev account, with their posters and `.torrent` files as PDS blobs.
- The `app.tortok.video.post` Lexicon has an optional `torrentBlob` holding the post's `.torrent` file, so a post can start with no peer (Decision 0020). The unused `hlsFallbackUrl` is gone.
- Production is smoke-checked every 15 minutes, read-only (`scripts/smoke.mjs`, `.github/workflows/smoke.yml`): `/health` with the deployed git SHA and Postgres reachable, the feed and TURN contract, and each feed item's webseed serving pieces that match its `.torrent`. It also fails when production is more than a day behind `main`'s backend. `npm run deploy:backend` deploys `main` with its SHA baked in and runs the same check after.
- Backend deploys are blue-green: traffic moves to a new machine only once it's serving, which needs Postgres.
- End-to-end tests run in CI on every pull request that changes code, on the iOS simulator and the Android emulator: sign-in, the feed, playback, pause, swiping, tabs, profile and sign-out (Detox, against a throwaway local stack with its own atproto PDS; Decision 0021).
- CI on GitHub Actions: the backend typecheck and Jest suite (with a Postgres 17 service) and the doc linter run on every pull request and push to `main`.
- tortok is licensed under Apache-2.0 (`LICENSE`), and the repository is public.
- `scripts/seed-prod-test-content.mjs` publishes the Big Buck Bunny test clips to an environment (R2 upload + feed rows), each playable from its R2 webseed with no seeder.
- `scripts/webseed-only-test.mjs` checks that a torrent downloads completely from its webseed with all peer discovery off.

### Changed

- Native build logs are mostly quiet: dependencies' compiler warnings are suppressed at `expo prebuild` (iOS from about 3,700 to about 580, Android from about 730 to about 5). `TORTOK_NATIVE_WARNINGS=1` brings them back.
- The backend and tracker run on Node 22 (was Node 18, out of support since April 2025), in their Docker images and in CI.
- Production backend (`tortok-api` on Fly.io) keeps one machine running at all times, so the in-process origin seeder no longer stops when traffic idles.
- Backend seeder announces only to tortok's own trackers (`TRACKER_URLS`; local tracker in dev, `tortok-tracker.fly.dev` in production), not public `wss://` trackers.
- Content is served from `content.tortok.net`, the R2 bucket's custom domain behind Cloudflare's cache, instead of the rate-limited `r2.dev` URL. Production webseeds, torrent files and posters use it.
- Production feed is the five Big Buck Bunny test clips; the stale April test video is gone. Detox feed/navigation tests updated to match.
- The public R2 bucket now sends CORS headers for `GET`/`HEAD` with `Range`, so the web client can use the webseed.
- Postgres SSL follows the `sslmode` in `DATABASE_URL`; production connects over Fly's private network with `sslmode=disable`.
- Production boot fails if `CONTENT_ORIGIN_URL` or `TRACKER_URLS` is unset; `backend/fly.toml` sets both, and the seeder has no production defaults.
- The Android app no longer requests camera, microphone, Bluetooth, overlay or audio-settings permissions; they return when recording is built.
- The repository has a root `README.md` with a layout map and a local quickstart.

### Removed

- The Like button, and like and view counts in the feed: Phase 3 ships no likes.
- `react-native-reanimated` and `react-native-worklets`, unused template dependencies whose Android release build failed with this Gradle plugin version.
- Google Cloud Run deployment (`backend/deploy.sh`) and the Cloud SQL socket handling; Fly.io is the only backend deployment.
- The standalone `tortok-seeder` Fly app, destroyed after a spike showed the R2 webseed alone delivers complete content.
- The Swift-era `designs/` specifications; their still-current content moved into the open problems, release plan and release process.

### Fixed

- The feed loads after signing in with Bluesky. It used to wait for a legacy login token that atproto sign-in never creates, so the Home tab stayed empty. The Profile tab shows the signed-in handle and the sign-out button instead of rendering blank.
- On Android, a fast swipe moves one video, as on iOS; it used to fly past several.
- Release builds no longer crash when a video's magnet lists a `ws://` tracker (a `bittorrent-tracker` bug, patched in `tortok/patches/`).
- `SeederService`'s webseed URL is now the parent of each seeded directory, so webseed fetches for its multi-file torrents no longer 404.
- Backend shuts down gracefully on both SIGINT (Ctrl+C) and SIGTERM (which `backend/fly.toml` now sets as Fly's kill signal), closing HTTP, the seeder, and the Postgres pool under a deadline. Previously only SIGTERM was handled, so Fly stops skipped it.
- Spike seeder (`test-content/seeder.mjs`) shuts down cleanly on SIGTERM from `scripts/dev-down.sh`, not just Ctrl+C.
