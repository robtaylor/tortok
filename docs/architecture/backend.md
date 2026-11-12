# Backend / AppView

*Reference: the current design as it stands in the code. The why lives in the decision records linked from each section; the not-yet-built work is under [Implementation status](#implementation-status). Present tense means "true today". If a claim here is stale, the code moved and this doc didn't.*

The backend (`backend/`) is a single Node + TypeScript Express process backed by Postgres. It is an AppView: it indexes `app.tortok.video.post` records from the network into its own tables ([Decision 0017](decisions/0017-appview-postgres-is-a-rebuildable-index.md)) and serves them as a read-only feed, with their blobs from its own blob route. It also issues TURN credentials. It has no accounts, no auth and no write routes: content reaches it only through atproto. Rationale for staying on Node/TypeScript and growing into an AppView: [Decision 0005](decisions/0005-backend-node-appview.md).

## Process and boot

`backend/src/index.ts` builds the Express app and starts it. The middleware stack is `helmet`, `cors`, JSON and urlencoded body parsers (10 MB limit each), and `morgan` (`combined` in production, `dev` otherwise). CORS allows every origin when `ALLOWED_ORIGINS` is unset or `*`; otherwise it allows the comma-separated list, with credentials.

`start()` runs in order:

1. `initializeDatabase()` applies `db/schema.sql`. A failure here exits the process with code 1.
2. `ingest.start()` starts [atproto ingest](#atproto-ingest). A failure here exits the process with code 1.
3. `app.listen(PORT)`, default port 8080.

On `SIGTERM` or `SIGINT` the process shuts down once, in order: it stops the HTTP server (closing idle keep-alive connections) while stopping ingest (which saves its cursor), then closes the Postgres pool once in-flight requests have drained, and exits 0. An error in any step exits 1, and an 8-second deadline forces exit 1 if shutdown stalls.

Unmatched routes return `404 {"error":"Not found"}`. Uncaught route errors return `500 {"error":"Internal server error"}`; the underlying `message` is included only when `NODE_ENV=development`.

## HTTP surface

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/health` | none | `index.ts`: status, Postgres reachability as `database` (`SELECT 1`), the image's `GIT_SHA` and `BUILD_TIME`, timestamp, `INSTANCE_DOMAIN`. Always 200 once serving: the server listens only after reaching Postgres at boot, and a later outage is reported, not failed, so Fly doesn't route around the only machine |
| GET | `/turn/credentials` | none | `index.ts`: ICE servers (see [TURN credentials](#turn-credentials)) |
| GET | `/blob/:did/:cid` | none | `routes/blob.ts`: an indexed author's blob (poster, avatar, `.torrent`); see [Feed](#videos-and-feed) |
| GET | `/videos/feed` | none | `routes/videos.ts`, `services/feedView.ts`: indexed posts |
| GET | `/videos/:id` | none | `routes/videos.ts`: one indexed post, by URL-encoded AT-URI |

The Expo client calls `/videos/feed` and fetches the blob URLs the feed hands it (`tortok/lib/api.ts`), from the AppView it is set to ([client](client.md#api-client)).

### Videos and feed

- **Feed** (`GET /videos/feed`) returns the indexed `app.tortok.video.post` rows of `posts`, joined with their author's `profiles` row, newest first by the record's `createdAt` (ties by AT-URI), with offset pagination: `limit` (default 20, at most 50) and `offset` (default 0). The response carries `nextCursor` (the next offset as a string, or `null`) and `hasMore`. There is no ranking, following filter or personalisation, and no like or view counts. Each item has:
  - `id` (the AT-URI) and the record `cid`;
  - `author`: DID, `handle` (`null` unless it verified), display name, avatar URL;
  - `caption`, `hashtags` (each beginning with `#`), `durationSeconds`, `width`, `height`, `createdAt`;
  - `posterURL`, and `playback`: `kind: 'torrent'`, the record's `magnetLink`, a `torrentFileUrl`, and `sources: { webseeds, trackers }`, the extra sources the client merges into WebTorrent ([Decision 0022](decisions/0022-clients-learn-extra-video-sources-from-their-appview.md)). `trackers` is `TRACKER_URLS`; `webseeds` is empty, since tortok has no mirrors yet.

  Poster, avatar and `.torrent` URLs point at the blob route on `PUBLIC_BASE_URL` (set in `fly.toml`), or on the request's own host when it's unset.
- **Blob** (`GET /blob/:did/:cid`) serves a blob of an author in `profiles`, fetched from the PDS their DID document names (`com.atproto.sync.getBlob`). It checks the bytes against the CID (`atproto/cid.ts`) and returns them with `Cache-Control: public, max-age=31536000, immutable`, so Cloudflare and clients cache them for good. Unknown authors get 404 without any request; blobs over 5 MB get 413; a PDS error is 502, and a timeout (10 s) 504. Only image and `application/x-bittorrent` types pass through; anything else is served as `application/octet-stream` with a sandboxing CSP, so a hostile PDS can't serve a page on this origin.

## Auth

The backend has no auth. Sign-in is atproto OAuth against the user's own PDS, run on the client ([client](client.md#authentication)); the backend holds no accounts or passwords ([Decision 0007](decisions/0007-signup-and-spam-prevention.md)). Every route is public and read-only.

## Database

`backend/src/db/index.ts` owns a single `pg` pool (max 20 connections, 30 s idle timeout, 2 s connect timeout). `DATABASE_URL` defaults to `postgresql://localhost:5432/tortok` outside production. In production the module throws at import time if `DATABASE_URL` is unset. SSL is set only by the URL's `sslmode`; production on Fly connects to `tortok-db.flycast` with `sslmode=disable` over Fly's private network. A pool `error` event exits the process. In development every query is logged with its duration.

**Schema** lives in one file, `db/schema.sql`, applied in full on every boot. There is no migrations directory; changes are idempotent statements appended to that file (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded renames, `DROP … IF EXISTS`). Tables:

| Table | Holds |
|---|---|
| `posts` | Indexed post records, keyed by AT-URI: record CID, caption, duration, dimensions, hashtags, magnet, infohash, and blob CIDs for the thumbnail and `.torrent`. Columns for bridged Bluesky posts (`video_cid`, `hls_url`) are unused until 2.5D. Written only by ingest. |
| `profiles` | Authors: handle (null if it doesn't verify), display name, avatar CID, PDS endpoint, refresh time. |
| `ingest_cursor` | The Jetstream resume cursor. Operator-local: a rebuild needs it. |
| `known_accounts` | DIDs backfilled on boot, with how each became known (`jetstream` or `seed`). Operator-local. |

Everything except the two operator-local tables can be rebuilt from the network (Decision 0017).

The file begins by dropping the legacy native tables (`users`, `videos`, `hashtags`, `video_hashtags`, `follows`, `likes`, `views`) and their trigger functions. Each table goes only while it still has a column only its legacy shape had, so a later table reusing one of those names survives every boot (`__tests__/schema.test.ts`). It also drops the `bridged_posts` and `bridge_cursor` tables left by the abandoned first attempt at Phase 3 Unit 2.5. Nothing records views; what a view means is unresolved ([`open-problems/view-counting.md`](open-problems/view-counting.md)).

## atproto ingest

`services/atprotoIngest.ts` indexes `app.tortok.video.post` records into `posts`. It runs in this process, started at boot.

- **Live:** it subscribes to Jetstream (`JETSTREAM_URL`, default `wss://jetstream2.us-east.bsky.network/subscribe`) with `wantedCollections=app.tortok.video.post`, so records from every PDS on the relay arrive as create, update and delete events. Events are handled one at a time, in order. It reconnects with backoff from 1 s to 60 s.
- **Cursor:** saved to `ingest_cursor` every 5 s and on shutdown. On reconnect it resumes 5 s before the saved cursor; upserts are idempotent, so replayed events change nothing.
- **Validation:** every record passes `atproto/videoPost.ts`, a hand-written check against `lexicons/app/tortok/video/post.json`: required fields, size and grapheme limits, blob MIME types, and a magnet whose infohash matches `infoHash`. An invalid record is skipped; an edit that makes a record invalid deletes the indexed version.
- **Writes:** an upsert keyed by AT-URI replaces a row only when the record CID changes. A delete event deletes the row.
- **Authors:** `atproto/identity.ts` resolves a DID from its own sources, not from Bluesky's AppView. The DID document (PLC directory, or `did:web`'s well-known file) gives the PDS endpoint and the claimed handle. The handle is kept only if its `_atproto` DNS TXT record or `/.well-known/atproto-did` names the same DID. The PDS's `app.bsky.actor.profile` record gives the display name and avatar. Profiles are refreshed when older than 24 hours, and at once on a Jetstream identity event for a known account.
- **Known accounts:** a DID becomes known the first time Jetstream shows it posting a valid record, or from `INGEST_SEED_DIDS` (comma-separated). Production seeds the dev account, `tortok-dev.bsky.social`. `PLC_DIRECTORY_URL` (default `https://plc.directory`) is where `did:plc` documents come from; the e2e stack points it at its own PLC.
- **Backfill:** on boot, each known account's records are re-listed with `com.atproto.repo.listRecords` from its PDS, four accounts at a time. Valid records are upserted, and rows the listing no longer has are deleted, except rows indexed after the listing began.

## Local development

`scripts/dev-up.sh` starts the backend (`npm run dev` on :8080) alongside the local tracker (:8000) and the content server (:8090) from `test-content/`, which seeds the test clips.

## TURN credentials

`GET /turn/credentials` issues coturn time-limited credentials. The username is `<expiry>:tortok` with a 24-hour TTL, and the credential is the base64 HMAC-SHA1 of the username keyed by `TURN_SECRET`. It returns STUN and TURN entries for `tortok-turn.fly.dev:3478`. With `TURN_SECRET` unset it returns the STUN entry only. The TURN server itself is covered in [p2p-torrent](p2p-torrent.md#trackers-and-turn).

## Deployment and configuration

- **Image:** `backend/Dockerfile` is a two-stage `node:22-alpine` build. It runs as a non-root user, copies `schema.sql` next to the compiled `dist/db/`, and health-checks `/health`. The `GIT_SHA` and `BUILD_TIME` build args become environment variables that `/health` reports; an image built without them reports `null`.
- **Fly.io** is the only deployment target. `backend/fly.toml` deploys app `tortok-api` in `lhr` on `shared-cpu-1x` / 512 MB machines. The machine count isn't in `fly.toml`; it's set with `fly scale count` and is 1 (checked 2026-11-09), so there is exactly one Jetstream subscriber. The app forces HTTPS and has a `/health` check. It never auto-stops its machine (`auto_stop_machines = "off"`), because a stopped machine would miss Jetstream events: a gap longer than Jetstream's replay window is lost for accounts that aren't known. It stops machines with `SIGTERM` and a 10 s `kill_timeout`, inside which the 8 s shutdown deadline fits. It answers on `tortok-api.fly.dev` and, publicly, on `appview.tortok.app` (below). Deploys are blue-green (`[deploy] strategy`): Fly starts the new machine beside the old one and moves traffic only once its `/health` check passes. The server listens only after `start()` has reached Postgres and initialised the schema, so an image that can't do either never serves. For the minute or so both run, there are two Jetstream connections; ingest's upserts are idempotent, so the overlap is harmless.
- **Public domain:** `appview.tortok.app` is the AppView's address: clients default to it and the feed's blob URLs use it (`PUBLIC_BASE_URL`). It is a proxied CNAME in Cloudflare's `tortok.app` zone to the Fly app, which holds a Let's Encrypt certificate for the name (`fly certs`, validated through an unproxied `_acme-challenge.appview` CNAME; `_fly-ownership.appview` is the ownership TXT). The zone's SSL mode is Full. A Cache Rule makes `/blob/*` on that host cacheable with the origin's `Cache-Control`, so Cloudflare keeps each blob for a year; everything else (the feed, `/health`) passes through uncached.
- **Deploying:** `npm run deploy:backend` (`scripts/deploy-backend.sh`) deploys only a clean checkout at `origin/main`, passes the commit's SHA and the build time as build args, then runs the smoke check against production expecting that SHA. Deploys are run by hand; nothing deploys on merge, so merging a change to the feed's shape without deploying it makes the scheduled smoke check fail every 15 minutes until production catches up.
- **Smoke check:** `scripts/smoke.mjs <base-url> [--expect-sha <sha>]` is read-only. It checks `/health` (healthy, Postgres reachable, a SHA), the feed and `/turn/credentials` contract (a TURN server with credentials), and, for up to five feed items, that the `.torrent`'s info hash matches the magnet and that its first and last pieces, fetched from the magnet's webseed with no peers, match the piece hashes. `.github/workflows/smoke.yml` runs it against production every 15 minutes and on demand, then fails if production is missing a backend commit that reached `main` more than a day ago. A failed run emails the repository owner. Its tests (`scripts/smoke.test.mjs`) run in CI against a stub backend serving a real production torrent (`scripts/fixtures/bbb-01.torrent`) and its clip.
- **Environment:** documented in `backend/.env.example`. Required in production: `DATABASE_URL` and `TRACKER_URLS`. Optional with code defaults: `PORT`, `NODE_ENV`, `INSTANCE_DOMAIN`, `ALLOWED_ORIGINS`, `TURN_SECRET`, `JETSTREAM_URL`, `INGEST_SEED_DIDS`, `PLC_DIRECTORY_URL`, `PUBLIC_BASE_URL`, and `TRACKER_URLS` outside production. `TRACKER_URLS` is read by the feed (`config.ts`). `scripts/init-dev-secrets.sh` (run by `dev-up.sh`) fills in `TURN_SECRET` for local development.

## Constraints

- **Record limits** are the Lexicon's, enforced by ingest's validator (`atproto/videoPost.ts`).
- **Request bodies** are capped at 10 MB. Video bytes never pass through the backend; it serves posters, avatars and `.torrent` files only.
- **Single process:** the API, ingest and the schema bootstrap share one process, so the API machine is kept always-on for ingest.
- **Tests:** `npm test` runs Jest over `src/__tests__/`. Ingest has integration tests against a real Postgres: each test file creates a throwaway database from `TEST_PG_ADMIN_URL` (default the local server) and applies `schema.sql`, with Jetstream, DID resolution and PDS calls stubbed. The feed routes have the same kind of integration test, with records put in through ingest. The blob route, the CID function (against a real PDS blob), the record validator and the identity resolver have unit tests. CI (`.github/workflows/ci.yml`) runs `tsc` and `npm test` on Node 22 with a Postgres 17 service, on every pull request and every push to `main`.

## Implementation status

**Implemented:**

| Part | Where |
|---|---|
| Feed and single post from indexed records | `backend/src/routes/videos.ts`, `backend/src/services/feedView.ts` |
| Blob route with CID check | `backend/src/routes/blob.ts`, `backend/src/atproto/cid.ts` |
| Postgres pool and boot-time schema | `backend/src/db/index.ts`, `backend/src/db/schema.sql` |
| TURN credential issuance | `backend/src/index.ts` |
| Graceful shutdown (SIGTERM/SIGINT) | `backend/src/index.ts` |
| atproto ingest: Jetstream, backfill, validation, author resolution | `backend/src/services/atprotoIngest.ts`, `backend/src/atproto/` |
| Fly.io deployment, always-on | `backend/Dockerfile`, `backend/fly.toml` |

**Deferred:**

| Part | Gap | Tracking |
|---|---|---|
| Account lifecycle | Jetstream `account` events (takedown, deactivation) are ignored, and known accounts are never removed. | Phase 4 |
| Bluesky bridge | No bridge code on the backend; the attempt-1 tables are dropped on boot. | Phase 3 Unit 2.5D; [federation](federation.md) |
| Own PDS | No PDS is run; users log in against their existing PDS. | [`open-problems/own-pds.md`](open-problems/own-pds.md) |
| Social graph | No follows or likes; they will reuse Bluesky's Lexicons. | Later phase |
| View recording | Nothing records views. | [`open-problems/view-counting.md`](open-problems/view-counting.md), Phase 4 |

## Decisions behind this

- [Decision 0005 — Backend stays Node + TypeScript; evolves into an AppView](decisions/0005-backend-node-appview.md)
- [Decision 0006 — Migration path from the Swift prototype](decisions/0006-migration-from-swift.md) — phased the legacy feed and email/password backend out (retired in Phase 3 Unit 2.5C).
- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md) — login is atproto OAuth; the backend holds no passwords.
- [Decision 0017 — The AppView's Postgres is a rebuildable index, one of many](decisions/0017-appview-postgres-is-a-rebuildable-index.md) — Postgres becomes a derived index; clients choose their AppView at runtime.
