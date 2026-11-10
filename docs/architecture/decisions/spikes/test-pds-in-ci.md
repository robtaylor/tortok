# Spike — Can CI run a throwaway atproto PDS that tortok signs in to and ingests from?

**Status:** Resolved (2026-11-10) — YES; Bluesky's `@atproto/dev-env` starts a PLC and a PDS in-process on GitHub's Linux and macOS runners in under a second, allows unlimited app-password logins, and tortok's ingest backfills records from it with only its PLC URL changed.

## Question

Can a CI job run its own PLC directory and PDS, create a test account, sign in to it with an app password as often as end-to-end tests need, publish an `app.tortok.video.post` record with blobs, and have tortok's ingest index that record?

## Why this is in question

The Detox suite needs a signed-in user. The only test account, `tortok-dev.bsky.social`, allows about 10 logins a day. With a fresh app install per test file, two platforms and every pull request, real sign-ins against `bsky.social` would exhaust that within a day. The fallbacks were a dev-only button that sets the DID without contacting a PDS, which tests no real sign-in, or passing tokens from one login into every launch, which is more work. [Decision 0016](../0016-testing-strategy-where-each-kind-of-test-lives.md) also says end-to-end tests never run against production, and `bsky.social` is someone else's production.

## Approach

Script: `test-network/spike.mjs` on branch `spike/test-pds`, run locally and by workflow `spike-test-pds` (run [42836841362](https://github.com/robtaylor/tortok/actions/runs/42836841362)).

- **Q1.** Do a PLC and a PDS start on a runner? `TestNetworkNoAppView` from `@atproto/dev-env` 0.7.5, on fixed ports 2582 (PLC) and 2583 (PDS).
- **Q2.** Does a test account accept repeated app-password logins? Create an account, create an app password, log in 25 times with fresh agents.
- **Q3.** Does the PDS accept a tortok record with its blobs? Upload a JPEG thumbnail and an `application/x-bittorrent` blob, create the record.
- **Q4.** Does tortok's ingest backfill it? Run `AtprotoIngest.backfill()` from the backend build against a real Postgres, with `IdentityResolver({ plcDirectory })` pointed at the local PLC.
- **Q5.** Does the PDS serve what the app will need next? Fetch the torrent blob with `com.atproto.sync.getBlob`, and the OAuth authorization-server metadata.

## Decision matrix

| Outcome | Means | Action |
|---|---|---|
| Q1 fails | No hermetic PDS on hosted runners | Dev-only DID sign-in for Detox; revisit with a hosted test PDS |
| Q2 fails | Rate limits apply even locally | Pass one login's tokens into every launch |
| Q3 or Q4 fails | The PDS works for sign-in but not for tortok content | Use it for sign-in only; fixtures keep coming from the legacy feed |
| All pass | CI can own a whole atproto network | Detox signs in for real against the throwaway PDS; 2.5B onward tests ingest end to end |

## Outcome

All five passed, locally and on both `ubuntu-latest` and `macos-latest`, in about 10 seconds per run.

- **Q1:** PLC and PDS were up in 45–225 ms. PLC uses an in-memory database and the PDS uses SQLite in a temporary directory, so no Docker, Postgres or Redis is needed for them.
- **Q2:** 25 app-password logins in a row, with no rate limiting.
- **Q3:** the record was created, and the torrent blob kept its `application/x-bittorrent` MIME type.
- **Q4:** ingest indexed the record with its `torrent_cid` and saved the author's profile with PDS endpoint `http://localhost:2583`.
- **Q5:** `getBlob` returned the torrent with its MIME type, and `/.well-known/oauth-authorization-server` returned 200.

Constraints and findings:

- `@atproto/dev-env` and `@atproto/pds` need **Node 22 or later**. That prompted moving the backend and tracker to Node 22 (PR #20).
- The test account's handle (`alice.test`) has no DNS, so tortok's resolver stores its handle as null. End-to-end tests that show a handle need either a handle the runner can resolve or a test-only way to trust it.
- The install is about 390 MB of dependencies, so CI should cache it.
- The spike caught a real bug: `AtprotoIngest.backfill()` returned before pruning and saving the profile when run without `start()`. It was fixed in PR #17, with a test that fails on the old code.
- A local PDS isn't on the relay, so Jetstream never sees its records. End-to-end tests rely on backfill; the live Jetstream path stays covered by the backend integration tests.

The Detox baseline builds on this. CI starts the test network, creates the test account and publishes the fixtures, and the app's dev-only sign-in uses an app password against the local PDS. Until Phase 3 Unit 2.5B moves the feed onto `posts`, the feed still reads the legacy `videos` table, so the baseline seeds that too.
