# Decision 0016 — Testing strategy — where each kind of test lives

**Status:** Proposed.

**Current architecture:** [P2P & torrent engine § Device testing](../p2p-torrent.md#device-testing).

**TL;DR.** In the context of a backend that Phase 3 is about to rewrite and a client whose risky behaviour (P2P, playback) only shows up on devices, facing a near-empty test suite and no CI, we chose to put regression effort into Decision 0014's tier-1 emulator gate and into tests for *new* backend code, rather than backfilling unit tests for code scheduled for deletion. This gets us coverage where failures actually happen, at the cost of leaving the legacy backend effectively untested until it retires.

## Context

Today (2026-11-04) the repository has no CI at all: there is no `.github/` directory. The test suite is:

- **Backend:** `npm test` runs Jest over `backend/src/__tests__/`, which holds one placeholder smoke test (`expect(1 + 1).toBe(2)`). No route, middleware, or schema behaviour is under test.
- **Client:** `tortok/stores/auth.test.ts` (7 auth-store unit tests from Phase 3 Unit 2), and a Detox iOS suite in `tortok/e2e/` (`auth`, `feed`, `navigation`, `profile`, `session`), run by hand with `npm run e2e`. The Detox `login()` helper drives the legacy email/password form.

Three things shaped the decision:

1. **Most of the backend is about to be deleted.** Phase 3 Unit 2.5 (v2) Phase C retires `/auth/*`, the `users` table, `POST /videos` and the JWT middleware, and Phase B moves the feed onto a new `posts` table ([Decision 0006](0006-migration-from-swift.md), [Decision 0007](0007-signup-and-spam-prevention.md), [`phase-3-atproto.md`](../../plans/phase-3-atproto.md)). Tests written against those routes now would be deleted with them.
2. **The failures that cost us time were device-level.** The Phase 2 and Unit 2.5 attempt-1 bugs (Hermes polyfills, fs-chunk-store `name:` ENOENT, phantom peers from public trackers, AV1 clips the iOS Simulator silently won't play, bridged-content data shapes) were found by running the app against a swarm, not by unit tests. None would have been caught by backend route tests.
3. **Decision 0014 already scoped the device tiers** and named tier 1 (self-hosted emulators) as the CI regression backstop. It did not say how that relates to unit and integration tests, or what CI runs first.

## Decision

1. **No backfill of legacy-backend tests.** We do not write tests for `/auth/*`, `POST /videos`, `PATCH /videos/:id/urls`, likes or views on the legacy `videos` table. They are covered only by the manual and Detox flows until Phase C deletes them.
2. **New backend code ships with integration tests against a real Postgres.** The AppView ingest (`atprotoIngest`), the unified `posts` table and the feed that reads it are tested as they are written. Tests run against a disposable Postgres database (not mocks), and record-shape fixtures cover both `app.tortok.video.post` and bridged `app.bsky.feed.post` records. This is where `backend/npm test` earns its place.
3. **Tier 1 (Decision 0014) is the primary regression gate.** It is the first CI to stand up: two self-hosted Android emulators, a local tracker and a seeder exercise "feed loads → video plays over P2P → offload is accounted". The Detox suite is the starting point for the app-driving half.
4. **A thin API contract check runs before tier 1.** A short script hits `/health`, `/videos/feed` (and its successor) and `/turn/credentials` against the backend under test, and fails fast so a broken backend is not debugged as a P2P failure.
5. **Client unit tests stay targeted.** Pure logic with real edge cases (auth store, seeding-policy eviction, URL resolution) gets Jest unit tests. UI and player behaviour is left to Detox and tier 1/2.
6. **E2E login moves to atproto with the legacy retirement.** When Phase C removes email/password, the Detox `login()` helper moves to the atproto OAuth flow against a test account in the same change, so the suite never depends on a deleted backend.

## Alternatives considered

- **Backfill unit tests for the current backend first** — rejected because Phase 3 deletes most of the code under test within the same phase. The effort buys coverage of routes no client will call after Phase C.
- **Unit tests as the primary gate, device testing later** — rejected because the bugs that actually stalled Phase 2 and Unit 2.5 only appear on a device against a swarm. A green unit suite would not have caught any of them.
- **Mocked Postgres for backend tests** — rejected because the ingest's risk is in SQL and record shape (upserts, at-uri keys, denormalised author snapshots), which mocks don't exercise.
- **Defer all testing until Phase 4** — rejected because the tier-1 gate and the ingest tests are cheapest to build alongside the code they cover, and Phase 3 already ships the ingest.

## Consequences

- Testing effort lands where failures have happened: device P2P behaviour and the new ingest and feed path.
- The legacy backend stays effectively untested until Phase C. A regression there is caught only by the manual run or Detox, which is acceptable for code with a scheduled deletion.
- CI has to be built from nothing. Tier 1 needs headless emulators with KVM, which is the CI infrastructure cost Decision 0014 already accepted.
- The Detox suite needs a login change at Phase C (commitment 6), so it lands in the same change as the retirement.

## Walk-back options

- **If Phase C slips well past Phase 3** — the legacy routes live longer than planned; add contract tests for the endpoints the client calls (`/auth/login`, `/auth/me`, `/videos/feed`) rather than full route coverage.
- **If tier-1 emulators prove too flaky to gate on** — demote tier 1 to a nightly job and gate PRs on the API contract check plus the ingest integration tests until the emulator rig is stable.
- **If the backend grows logic that isn't ingest or feed** (rate limits per Decision 0007, upload quotas) — that logic follows commitment 2: tests ship with the code.

## Links

- [Decision 0014](0014-device-testing-strategy.md) — the three device-testing tiers this decision places unit, integration and contract tests around.
- [Decision 0015](0015-tier3-p2p-testing-lambdatest.md) — tier-3 vendor choice.
- [Decision 0006](0006-migration-from-swift.md), [Decision 0007](0007-signup-and-spam-prevention.md) — schedule and rationale for retiring the legacy backend.
- [`phase-3-atproto.md`](../../plans/phase-3-atproto.md) — Unit 2.5 (v2) Phases A–C.
