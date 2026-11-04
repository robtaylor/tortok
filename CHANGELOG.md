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

- <New feature> (`docs/<guide>.md`).

### Changed

- Production backend (`tortok-api` on Fly.io) keeps one machine running at all times, so the in-process origin seeder no longer stops when traffic idles.
- Backend seeder announces only to tortok's own trackers (`TRACKER_URLS`; local tracker in dev, `tortok-tracker.fly.dev` in production), not public `wss://` trackers.

### Removed

- Google Cloud Run deployment (`backend/deploy.sh`) and the Cloud SQL socket handling; Fly.io is the only backend deployment.

### Fixed

- Backend shuts down gracefully on both SIGINT (Fly.io's default kill signal, Ctrl+C) and SIGTERM, closing HTTP, the seeder, and the Postgres pool under a deadline. Previously only SIGTERM was handled, so Fly stops skipped it.
- Spike seeder (`test-content/seeder.mjs`) shuts down cleanly on SIGTERM from `scripts/dev-down.sh`, not just Ctrl+C.
