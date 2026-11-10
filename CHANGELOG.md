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

- tortok is licensed under Apache-2.0 (`LICENSE`), and the repository is public.
- `scripts/seed-prod-test-content.mjs` publishes the Big Buck Bunny test clips to an environment (R2 upload + feed rows), each playable from its R2 webseed with no seeder.
- `scripts/webseed-only-test.mjs` checks that a torrent downloads completely from its webseed with all peer discovery off.

### Changed

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

- Google Cloud Run deployment (`backend/deploy.sh`) and the Cloud SQL socket handling; Fly.io is the only backend deployment.
- The standalone `tortok-seeder` Fly app, destroyed after a spike showed the R2 webseed alone delivers complete content.
- The Swift-era `designs/` specifications; their still-current content moved into the open problems, release plan and release process.

### Fixed

- `SeederService`'s webseed URL is now the parent of each seeded directory, so webseed fetches for its multi-file torrents no longer 404.
- Backend shuts down gracefully on both SIGINT (Ctrl+C) and SIGTERM (which `backend/fly.toml` now sets as Fly's kill signal), closing HTTP, the seeder, and the Postgres pool under a deadline. Previously only SIGTERM was handled, so Fly stops skipped it.
- Spike seeder (`test-content/seeder.mjs`) shuts down cleanly on SIGTERM from `scripts/dev-down.sh`, not just Ctrl+C.
