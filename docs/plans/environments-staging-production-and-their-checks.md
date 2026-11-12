# Plan — Environments — staging, production, and their checks: know what's deployed and that it works

**Status:** Active — direct production deploys allowed until public release (Decision 0016, commitment 12).

## Goal

Give tortok two backend environments, staging and production, a single smoke script that checks both, and a deploy path where production only ever runs an image staging has already passed. This implements the Environments section of [Decision 0016](../architecture/decisions/0016-testing-strategy-where-each-kind-of-test-lives.md). Until public release, production may still be deployed directly (there are no users); WS3 and WS4 are what change that.

## Prerequisites

- Decision 0016 accepted. Done 2026-11-09.
- Production on current code. Done 2026-11-04: `tortok-api` was redeployed from `backend/seeder-lifecycle` (PR #4) after running a 2026-04-12 image for seven months.
- A Fly API token stored as a GitHub Actions secret (`FLY_API_TOKEN`) for WS3.

## Where things stand (2026-11-04)

- **Environments:** production only (`tortok-api`, `tortok-db`, `tortok-tracker`, `tortok-turn`); [`backend.md`](../architecture/backend.md) describes the deployment. No staging.
- **CI:** `.github/workflows/ci.yml` runs the backend typecheck and tests and the doc linter on pull requests and pushes to `main`. Nothing deploys from CI; deploys are a manual `fly deploy` from a laptop.
- **Checks:** none automated. The 2026-11-04 deploy was verified by hand (`/health`, feed shape, `/turn/credentials`, `/seeder/stats`, a graceful-shutdown restart).
- **Content:** production's feed is exactly the five Big Buck Bunny test clips, owned by `testuser` and published by `scripts/seed-prod-test-content.mjs` (R2 under `test-content/`, own tracker, per-file webseed, `bbb-01` newest). Each was verified to download completely from the webseed alone. The April `testuser3` row, which had no webseed, was deleted; the Detox `feed`/`navigation` tests now expect the clips. The webseed-only spike ([`webseed-only-origin.md`](../architecture/decisions/spikes/webseed-only-origin.md)) gives the check WS2 runs.
- **Content domain:** the bucket is served at `content.tortok.net` (added 2026-11-08). Production sets `CONTENT_ORIGIN_URL` in `backend/fly.toml`; staging needs its own value.
- **R2 CORS:** the public bucket allows `GET`/`HEAD` from any origin with the `Range` header and exposes `Content-Range`, `Content-Length`, `Accept-Ranges` and `ETag` (set 2026-11-04 via the S3 API; preflight verified). Any origin is safe because the bucket is public and unauthenticated.

## Workstreams

### WS1 — Deployed-version visibility

**Status:** Done 2026-11-11. `/health` reports `sha`, `buildTime` and `database`; `scripts/deploy-backend.sh` passes the build args. Deploys are also blue-green, so traffic moves only once the new machine's `/health` passes, which it can only do after reaching Postgres.

`/health` reports the git SHA and build time the image was built from (a build arg baked in by the `Dockerfile`), so any check can assert what is actually running. This alone would have caught the seven-month-stale production.

**Deliverables:**

- `GIT_SHA` / `BUILD_TIME` build args in `backend/Dockerfile`, surfaced by `/health`.
- `fly deploy` invoked with `--build-arg GIT_SHA=$(git rev-parse HEAD)` (script or CI step).

**Exit criteria:**

- `curl https://tortok-api.fly.dev/health` returns the SHA of the last deploy.

### WS1b — Content and R2 for every environment

**Status:** Production done 2026-11-04 (content published, CORS set); staging follows WS3.

Content is `app.tortok.video.post` records in the test account's repo, published once by `scripts/seed-fixtures.mjs`, and every environment's AppView indexes the same records from Jetstream. Their webseeds are the clips on the production bucket, put there by `scripts/upload-test-clips.mjs`. Staging needs no content of its own.

**Deliverables:**

- Nothing per environment.
- An R2 CORS rule on the public bucket allowing `GET`/`HEAD` with the `Range` header from the app's web origins, exposing `Content-Range`/`Content-Length`.

**Exit criteria:**

- Every feed item in each environment passes the WS2 webseed check, from native and web clients.

### WS2 — Smoke script, run against any environment

**Status:** Done 2026-11-11: `scripts/smoke.mjs`, tested against a stub backend in CI (`scripts/smoke.test.mjs`), including the no-webseed failure. The webseed check verifies the first and last pieces against the `.torrent` from `torrentFileUrl`, with no WebTorrent client.

One script, `scripts/smoke.mjs <base-url> [--expect-sha <sha>]`, that is read-only and safe to run against production. It is also the API contract check Decision 0016 runs before tier 1.

**Deliverables:**

- **Version:** `/health` is healthy and, if given, reports the expected SHA.
- **Contract:** response shapes of `/health`, the feed endpoint and `/turn/credentials`; TURN credentials are present (fails if `TURN_SECRET` is missing). `/.well-known/tortok` is retired in Unit 2.5C (Decision 0017, item 6), so the contract doesn't check it.
- **Webseed:** for each feed item (capped), load its torrent metadata and fetch at least one piece from its webseed with trackers, DHT and LSD off; the torrent's piece hash verifies the bytes, so no local mirror is needed. It generalised `scripts/webseed-only-test.mjs`, since deleted.
- Non-zero exit and a one-line reason per failure.

**Exit criteria:**

- The script passes against a correctly populated environment and fails, with a clear reason, against a feed item whose magnet has no webseed.

### WS3 — Staging environment and image promotion

**Status:** Not started. Required before public release.

**Deliverables:**

- `tortok-api-staging` (Fly, `lhr`) with its own small Postgres (`tortok-db-staging`), sharing `tortok-tracker` and `tortok-turn` with production. Own `INSTANCE_DOMAIN`, and its own `JWT_SECRET` if staging exists before Unit 2.5C removes it.
- GitHub Actions: on push to `main`, build once, deploy to staging, run the WS2 smoke against staging.
- Promotion to production redeploys **the same image** staging passed (`fly deploy --image registry.fly.io/tortok-api-staging@sha256:…` or a shared tag), never a rebuild, then runs the WS2 smoke against production with `--expect-sha`.
- Write-path checks (login, publish a record) run against staging only, using the test account; sessions are reused because the account allows 10 logins/day.

**Exit criteria:**

- A merge to `main` reaches staging and runs the smoke with no manual step.
- Production can be updated only by promoting an image that passed staging.

### WS4 — Production monitoring and schema rehearsal

**Status:** Scheduled smoke done 2026-11-11 (`.github/workflows/smoke.yml`, every 15 minutes; alerting is GitHub's failed-run email). It also fails when production is missing a backend commit that reached `main` over a day ago. Schema rehearsal not started. Required before public release.

**Deliverables:**

- The WS2 smoke against production on a schedule (every 15 minutes, GitHub Actions cron or a Fly scheduled machine), alerting on failure.
- Schema rehearsal: because `schema.sql` runs on every boot, each production promotion first restores a recent production backup into staging and boots the candidate image against it.

**Exit criteria:**

- A broken production endpoint raises an alert within 15 minutes.
- A promotion whose schema fails on production data is caught in staging.

### WS5 — Tier 1 against staging

**Status:** Not started; follows the tier-1 rig of [Decision 0014](../architecture/decisions/0014-device-testing-strategy.md).

The self-hosted emulator gate runs the full app against **staging**, never production, after the WS2 smoke passes.

**Exit criteria:**

- Tier 1 runs in CI against staging on every merge to `main`.

## Phase exit criteria

When all of these are true, this plan closes:

- [ ] `/health` reports the deployed SHA in both environments.
- [ ] The smoke script runs against staging on every merge and against production on a schedule.
- [ ] Production is updated only by promoting a staging-tested image.
- [ ] Tier 1 runs against staging.
- [ ] All workstreams shipped or explicitly deferred to a successor plan.

## References

- [`architecture/decisions/0016-testing-strategy-where-each-kind-of-test-lives.md`](../architecture/decisions/0016-testing-strategy-where-each-kind-of-test-lives.md) — the decision this plan implements.
- [`architecture/decisions/0014-device-testing-strategy.md`](../architecture/decisions/0014-device-testing-strategy.md) — tier 1, which WS5 points at staging.
- [`architecture/decisions/spikes/webseed-only-origin.md`](../architecture/decisions/spikes/webseed-only-origin.md) — the webseed check WS2 generalises.
- [`architecture/backend.md`](../architecture/backend.md) — current deployment and configuration.
- [`release-plan.md`](release-plan.md) — WS3 and WS4 are prerequisites for public release.
