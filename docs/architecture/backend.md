# Backend / AppView

*Reference: the current design as it stands in the code. The why lives in the decision records linked from each section; the not-yet-built work is under [Implementation status](#implementation-status). Present tense means "true today". If a claim here is stale, the code moved and this doc didn't.*

The backend (`backend/`) is a single Node + TypeScript Express process backed by Postgres. Today it serves the **legacy email/password API**: JWT auth, video metadata, the feed, likes and views. It also hosts the origin WebTorrent seeder in-process and issues TURN credentials. It has begun to become an AppView: it indexes `app.tortok.video.post` records from the network into its own tables ([Decision 0017](decisions/0017-appview-postgres-is-a-rebuildable-index.md)), and the feed serves them, with their blobs from its own blob route. Rationale for staying on Node/TypeScript and growing into an AppView: [Decision 0005](decisions/0005-backend-node-appview.md).

## Process and boot

`backend/src/index.ts` builds the Express app and starts it. The middleware stack is `helmet`, `cors`, JSON and urlencoded body parsers (10 MB limit each), and `morgan` (`combined` in production, `dev` otherwise). CORS allows every origin when `ALLOWED_ORIGINS` is unset or `*`; otherwise it allows the comma-separated list, with credentials.

`start()` runs in order:

1. `initializeDatabase()` applies `db/schema.sql`. A failure here exits the process with code 1.
2. `seeder.initialize()` starts the WebTorrent seeder. A failure here is logged as a warning and the server **continues without a seeder**.
3. `ingest.start()` starts [atproto ingest](#atproto-ingest). A failure here exits the process with code 1.
4. `app.listen(PORT)`, default port 8080.

On `SIGTERM` or `SIGINT` the process shuts down once, in order: it stops the HTTP server (closing idle keep-alive connections) while destroying the seeder client and stopping ingest (which saves its cursor), then closes the Postgres pool once in-flight requests have drained, and exits 0. An error in any step exits 1, and an 8-second deadline forces exit 1 if shutdown stalls.

Unmatched routes return `404 {"error":"Not found"}`. Uncaught route errors return `500 {"error":"Internal server error"}`; the underlying `message` is included only when `NODE_ENV=development`.

## HTTP surface

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/health` | none | `index.ts`: status, Postgres reachability as `database` (`SELECT 1`), the image's `GIT_SHA` and `BUILD_TIME`, timestamp, `INSTANCE_DOMAIN`. Always 200 once serving: the server listens only after reaching Postgres at boot, and a later outage is reported, not failed, so Fly doesn't route around the only machine |
| GET | `/.well-known/tortok` | none | `index.ts`: static instance info (`federationEnabled: false`, `supportedProtocols: ['tortok-v1']`) |
| GET | `/seeder/stats` | none | `index.ts`: seeder torrent/peer counts, upload speed, seeded torrent list |
| GET | `/turn/credentials` | none | `index.ts`: ICE servers (see [TURN credentials](#turn-credentials)) |
| GET | `/blob/:did/:cid` | none | `routes/blob.ts`: an indexed author's blob (poster, avatar, `.torrent`); see [Feed](#videos-and-feed) |
| GET | `/content/*` | none | `express.static` over `backend/content/`, with HLS content types and `Access-Control-Allow-Origin: *` |
| POST | `/auth/register` | none | `routes/auth.ts` |
| POST | `/auth/login` | none | `routes/auth.ts` |
| GET | `/auth/me` | JWT required | `routes/auth.ts` |
| POST | `/videos` | JWT required | `routes/videos.ts`: create video + hashtags |
| GET | `/videos/feed` | none | `routes/videos.ts`, `services/feedView.ts`: indexed posts |
| GET | `/videos/:id` | none | `routes/videos.ts`: one indexed post, by URL-encoded AT-URI |
| POST | `/videos/:id/like` | JWT required | `routes/videos.ts`: like / unlike |
| POST | `/videos/:id/view` | JWT optional | `routes/videos.ts`: record a view |
| PATCH | `/videos/:id/urls` | JWT required, owner only | `routes/videos.ts`: rewrite `magnet_link` / `torrent_file_url` |

The Expo client calls `/auth/register` and `/videos/feed`, and fetches the blob URLs the feed hands it (`tortok/lib/api.ts`); nothing calls the legacy like, view or create routes. It resolves the base URL from `EXPO_PUBLIC_API_URL`, falls back to the dev host on port 8080 in development, and uses `https://tortok-api.fly.dev` otherwise.

### Videos and feed

- **Create** (`POST /videos`) inserts the video and its hashtags in one transaction. Hashtags are lowercased and upserted into `hashtags`, incrementing `usage_count`, then linked through `video_hashtags`.
- **Feed** (`GET /videos/feed`) returns the indexed `app.tortok.video.post` rows of `posts`, joined with their author's `profiles` row, newest first by the record's `createdAt` (ties by AT-URI), with offset pagination: `limit` (default 20, at most 50) and `offset` (default 0). The response carries `nextCursor` (the next offset as a string, or `null`) and `hasMore`. There is no ranking, following filter or personalisation, and no like or view counts. Each item has:
  - `id` (the AT-URI) and the record `cid`;
  - `author`: DID, `handle` (`null` unless it verified), display name, avatar URL;
  - `caption`, `hashtags` (each beginning with `#`), `durationSeconds`, `width`, `height`, `createdAt`;
  - `posterURL`, and `playback`: `kind: 'torrent'`, the record's `magnetLink`, a `torrentFileUrl`, and `sources: { webseeds, trackers }`, the extra sources the client merges into WebTorrent ([Decision 0022](decisions/0022-clients-learn-extra-video-sources-from-their-appview.md)). `trackers` is `TRACKER_URLS`; `webseeds` is empty, since tortok has no mirrors yet.

  Poster, avatar and `.torrent` URLs point at the blob route on `PUBLIC_BASE_URL` (set in `fly.toml`), or on the request's own host when it's unset.
- **Blob** (`GET /blob/:did/:cid`) serves a blob of an author in `profiles`, fetched from the PDS their DID document names (`com.atproto.sync.getBlob`). It checks the bytes against the CID (`atproto/cid.ts`) and returns them with `Cache-Control: public, max-age=31536000, immutable`, so Cloudflare and clients cache them for good. Unknown authors get 404 without any request; blobs over 5 MB get 413; a PDS error is 502, and a timeout (10 s) 504. Only image and `application/x-bittorrent` types pass through; anything else is served as `application/octet-stream` with a sandboxing CSP, so a hostile PDS can't serve a page on this origin.
- **Like** (`POST /videos/:id/like`, body `{liked}`) inserts or deletes the `likes` row in a transaction and changes `like_count` only when a row actually changed, so repeated likes or unlikes do not drift the counter.
- **View** (`POST /videos/:id/view`) inserts a `views` row (`source` defaults to `http`) and increments `view_count`. The two statements are not in a transaction, and nothing deduplicates views. What a view *means* is unresolved: [`open-problems/view-counting.md`](open-problems/view-counting.md).
- **URL rewrite** (`PATCH /videos/:id/urls`) returns 404 for an unknown video and 403 unless the caller uploaded it. There is no admin role.

## Auth and validation

The backend's auth is the **legacy** email/password + JWT path, inherited from the Swift prototype. Login is decided to be atproto OAuth against the user's own PDS, with no tortok auth endpoint or stored passwords ([Decision 0007](decisions/0007-signup-and-spam-prevention.md)); that OAuth flow runs on the client and is documented in [client](client.md#authentication). Retiring this legacy backend is a Phase 3 deliverable ([Decision 0006](decisions/0006-migration-from-swift.md)).

- **Register** checks that the username and email are each unused *on this instance* (`INSTANCE_DOMAIN`, default `localhost`), hashes the password with bcrypt (cost 10), inserts the user, and returns `{token, user}`.
- **Login** looks the user up by email and instance, compares bcrypt hashes, and returns `{token, user}`. An unknown email and a wrong password both return the same 401.
- **Tokens** (`middleware/auth.ts`) are HS256 JWTs signed with `JWT_SECRET`, carrying `{userId, username, instance}` and expiring after `JWT_EXPIRES_IN` (default `7d`). There are no refresh tokens. The module **throws at import time if `JWT_SECRET` is unset**, so the server will not boot without it.
- `authenticateJWT` reads `Authorization: Bearer <token>`. It returns 401 for a missing header or token and for a token whose `instance` is not this instance, and 403 for a token that fails verification. `optionalAuth` sets `req.user` when a token verifies and silently continues otherwise; it does **not** check `instance`.
- **Validation** (`middleware/validate.ts`) runs Joi schemas over `req.body` with `abortEarly: false` and `stripUnknown: true`, replaces the body with the validated value, and returns `400 {error: 'Validation failed', details: [{field, message}]}` on failure. Registration passwords must be 10–128 characters and not in a built-in list of about 30 common passwords.

## Database

`backend/src/db/index.ts` owns a single `pg` pool (max 20 connections, 30 s idle timeout, 2 s connect timeout). `DATABASE_URL` defaults to `postgresql://localhost:5432/tortok` outside production. In production the module throws at import time if `DATABASE_URL` is unset. SSL is set only by the URL's `sslmode`; production on Fly connects to `tortok-db.flycast` with `sslmode=disable` over Fly's private network. A pool `error` event exits the process. In development every query is logged with its duration.

**Schema** lives in one file, `db/schema.sql`, applied in full on every boot. There is no migrations directory; changes are idempotent statements appended to that file (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded renames, `DROP … IF EXISTS`). Tables:

| Table | Holds |
|---|---|
| `users` | Legacy accounts: username, display name, email, bcrypt hash, bio, avatar, `instance_domain`, follower/following/video counts. Username and email are each unique per instance. |
| `videos` | Caption, `magnet_link`, `torrent_file_url`, `poster_url`, duration, dimensions, like/view counts. Also an `hls_url` column that no route reads or writes. |
| `hashtags`, `video_hashtags` | Hashtag names with `usage_count`, and the video↔hashtag join. |
| `likes` | One row per (user, video). |
| `views` | Append-only view events: optional user, watched duration, completion rate, `source` (`p2p` / `http` / `cache`). |
| `follows` | Follower/followed pairs with remote-instance columns. No route reads or writes it. |
| `posts` | Indexed post records, keyed by AT-URI: record CID, caption, duration, dimensions, hashtags, magnet, infohash, and blob CIDs for the thumbnail and `.torrent`. Columns for bridged Bluesky posts (`video_cid`, `hls_url`) are unused until 2.5D. Written only by ingest. |
| `profiles` | Authors: handle (null if it doesn't verify), display name, avatar CID, PDS endpoint, refresh time. |
| `ingest_cursor` | The Jetstream resume cursor. Operator-local: a rebuild needs it. |
| `known_accounts` | DIDs backfilled on boot, with how each became known (`jetstream` or `seed`). Operator-local. |

Everything except the two operator-local tables can be rebuilt from the network (Decision 0017).

Triggers keep `users.follower_count` / `following_count` in step with `follows`, and `users.video_count` in step with `videos`. The file ends by dropping the `bridged_posts` and `bridge_cursor` tables left by the abandoned first attempt at Phase 3 Unit 2.5.

## atproto ingest

`services/atprotoIngest.ts` indexes `app.tortok.video.post` records into `posts`. It runs in this process, started at boot.

- **Live:** it subscribes to Jetstream (`JETSTREAM_URL`, default `wss://jetstream2.us-east.bsky.network/subscribe`) with `wantedCollections=app.tortok.video.post`, so records from every PDS on the relay arrive as create, update and delete events. Events are handled one at a time, in order. It reconnects with backoff from 1 s to 60 s.
- **Cursor:** saved to `ingest_cursor` every 5 s and on shutdown. On reconnect it resumes 5 s before the saved cursor; upserts are idempotent, so replayed events change nothing.
- **Validation:** every record passes `atproto/videoPost.ts`, a hand-written check against `lexicons/app/tortok/video/post.json`: required fields, size and grapheme limits, blob MIME types, and a magnet whose infohash matches `infoHash`. An invalid record is skipped; an edit that makes a record invalid deletes the indexed version.
- **Writes:** an upsert keyed by AT-URI replaces a row only when the record CID changes. A delete event deletes the row.
- **Authors:** `atproto/identity.ts` resolves a DID from its own sources, not from Bluesky's AppView. The DID document (PLC directory, or `did:web`'s well-known file) gives the PDS endpoint and the claimed handle. The handle is kept only if its `_atproto` DNS TXT record or `/.well-known/atproto-did` names the same DID. The PDS's `app.bsky.actor.profile` record gives the display name and avatar. Profiles are refreshed when older than 24 hours, and at once on a Jetstream identity event for a known account.
- **Known accounts:** a DID becomes known the first time Jetstream shows it posting a valid record, or from `INGEST_SEED_DIDS` (comma-separated). Production seeds the dev account, `tortok-dev.bsky.social`. `PLC_DIRECTORY_URL` (default `https://plc.directory`) is where `did:plc` documents come from; the e2e stack points it at its own PLC.
- **Backfill:** on boot, each known account's records are re-listed with `com.atproto.repo.listRecords` from its PDS, four accounts at a time. Valid records are upserted, and rows the listing no longer has are deleted, except rows indexed after the listing began.

## Seeder

The origin WebTorrent seeder runs **inside this process** as the `seeder` singleton (`services/seeder.ts`). Its role in P2P delivery (webseed, R2 origin, trackers) is described in [p2p-torrent](p2p-torrent.md). On the backend side:

- `initialize()` loads `webtorrent` with a dynamic `import()` (it is ESM-only) and then seeds every subdirectory of `backend/content/` that contains a `playlist.m3u8`. That is the HLS layout; `backend/content/` holds one such fixture, `tortok-test-video`.
- Each directory is seeded by path alone, so the torrent name is the directory's basename. It announces only to tortok's own trackers: `TRACKER_URLS` (comma-separated). An explicitly empty list throws when the seeder is constructed. Each torrent gets a webseed URL of `${CONTENT_ORIGIN_URL}/videos`; for these multi-file torrents WebTorrent appends `<name>/<file>`, so pieces are fetched from `/videos/<name>/<file>`. In production, `CONTENT_ORIGIN_URL` and `TRACKER_URLS` have no code defaults: `backend/fly.toml` sets them (`https://content.tortok.net`, `wss://tortok-tracker.fly.dev`) and the seeder throws at boot if either is missing. Outside production they default to `http://localhost:8090` and `ws://localhost:8000`.
- Each directory has a 30 s seeding timeout, cleared once seeding starts. A timeout or error rejects `initialize()`, which skips any remaining directories; `start()` logs it and boots anyway.
- `/seeder/stats` reports the live counts. Video records in Postgres do not reference the seeder: magnets are stored as whatever the uploader sent.

In local development `scripts/dev-up.sh` starts the backend (`npm run dev` on :8080) alongside the spike tracker (:8000) and the spike content seeder (:8090) from `test-content/`. Those two are separate processes and are not this `SeederService`.

## TURN credentials

`GET /turn/credentials` issues coturn time-limited credentials. The username is `<expiry>:tortok` with a 24-hour TTL, and the credential is the base64 HMAC-SHA1 of the username keyed by `TURN_SECRET`. It returns STUN and TURN entries for `tortok-turn.fly.dev:3478`. With `TURN_SECRET` unset it returns the STUN entry only. The TURN server itself is covered in [p2p-torrent](p2p-torrent.md#trackers-and-turn).

## Deployment and configuration

- **Image:** `backend/Dockerfile` is a two-stage `node:22-alpine` build. It runs as a non-root user, copies `schema.sql` next to the compiled `dist/db/`, bakes `backend/content/` into the image, and health-checks `/health`. The `GIT_SHA` and `BUILD_TIME` build args become environment variables that `/health` reports; an image built without them reports `null`.
- **Fly.io** is the only deployment target. `backend/fly.toml` deploys app `tortok-api` in `lhr` on `shared-cpu-1x` / 512 MB machines. The machine count isn't in `fly.toml`; it's set with `fly scale count` and is 1 (checked 2026-11-09), so there is exactly one in-process seeder. The app forces HTTPS and has a `/health` check. It never auto-stops its machine (`auto_stop_machines = "off"`) so the in-process seeder never idles out, and stops machines with `SIGTERM` and a 10 s `kill_timeout`, inside which the 8 s shutdown deadline fits. This is the production URL the client defaults to; it answers `/health` as `tortok-api.fly.dev`. Deploys are blue-green (`[deploy] strategy`): Fly starts the new machine beside the old one and moves traffic only once its `/health` check passes. The server listens only after `start()` has reached Postgres and initialised the schema, so an image that can't do either never serves. For the minute or so both run, there are two in-process seeders and two Jetstream connections; ingest's upserts are idempotent, so the overlap is harmless.
- **Deploying:** `npm run deploy:backend` (`scripts/deploy-backend.sh`) deploys only a clean checkout at `origin/main`, passes the commit's SHA and the build time as build args, then runs the smoke check against production expecting that SHA. Deploys are run by hand; nothing deploys on merge.
- **Smoke check:** `scripts/smoke.mjs <base-url> [--expect-sha <sha>]` is read-only. It checks `/health` (healthy, Postgres reachable, a SHA), the feed and `/turn/credentials` contract (a TURN server with credentials), and, for up to five feed items, that the `.torrent`'s info hash matches the magnet and that its first and last pieces, fetched from the magnet's webseed with no peers, match the piece hashes. `.github/workflows/smoke.yml` runs it against production every 15 minutes and on demand, then fails if production is missing a backend commit that reached `main` more than a day ago. A failed run emails the repository owner. Its tests (`scripts/smoke.test.mjs`) run in CI against a stub backend serving a real production torrent (`scripts/fixtures/bbb-01.torrent`) and its clip.
- **Environment:** documented in `backend/.env.example`. Required: `JWT_SECRET` always; `DATABASE_URL`, `CONTENT_ORIGIN_URL` and `TRACKER_URLS` in production. Optional with code defaults: `PORT`, `NODE_ENV`, `JWT_EXPIRES_IN`, `INSTANCE_DOMAIN`, `INSTANCE_NAME`, `ALLOWED_ORIGINS`, `TURN_SECRET`, `JETSTREAM_URL`, `INGEST_SEED_DIDS` (plus the two seeder variables outside production). `scripts/init-dev-secrets.sh` (run by `dev-up.sh`) fills in `JWT_SECRET` and `TURN_SECRET` for local development.

## Constraints

- **Video metadata limits** (`schemas.createVideo`): caption ≤ 500 characters; `durationSeconds` 1–300; at most 10 hashtags, each ≤ 50 characters; `magnetLink` must start with `magnet:?`; `posterUrl` must be `https`; `torrentFileUrl` may be `http` or `https`.
- **Accounts:** usernames are alphanumeric, 3–30 characters; display names 1–100 characters.
- **Request bodies** are capped at 10 MB. The backend accepts metadata only; video bytes never pass through it.
- **Single process:** the seeder, the API and the schema bootstrap share one process, so the API machine is also the origin seeder and is kept always-on.
- **Tests:** `npm test` runs Jest over `src/__tests__/`. Ingest has integration tests against a real Postgres: each test file creates a throwaway database from `TEST_PG_ADMIN_URL` (default the local server) and applies `schema.sql`, with Jetstream, DID resolution and PDS calls stubbed. The feed routes have the same kind of integration test, with records put in through ingest. The blob route, the CID function (against a real PDS blob), the record validator and the identity resolver have unit tests. The legacy routes and middleware aren't under test. CI (`.github/workflows/ci.yml`) runs `tsc` and `npm test` on Node 22 with a Postgres 17 service, on every pull request and every push to `main`.

## Implementation status

**Implemented:**

| Part | Where |
|---|---|
| Legacy email/password auth, JWT issue/verify | `backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts` |
| Request validation | `backend/src/middleware/validate.ts` |
| Feed and single post from indexed records | `backend/src/routes/videos.ts`, `backend/src/services/feedView.ts` |
| Blob route with CID check | `backend/src/routes/blob.ts`, `backend/src/atproto/cid.ts` |
| Legacy video create, like, view, owner-only URL rewrite (uncalled) | `backend/src/routes/videos.ts` |
| Postgres pool and boot-time schema | `backend/src/db/index.ts`, `backend/src/db/schema.sql` |
| In-process origin seeder + stats | `backend/src/services/seeder.ts`, `backend/src/index.ts` |
| TURN credential issuance | `backend/src/index.ts` |
| Graceful shutdown (SIGTERM/SIGINT) | `backend/src/index.ts` |
| atproto ingest: Jetstream, backfill, validation, author resolution | `backend/src/services/atprotoIngest.ts`, `backend/src/atproto/` |
| Fly.io deployment, always-on | `backend/Dockerfile`, `backend/fly.toml` |

**Deferred:**

| Part | Gap | Tracking |
|---|---|---|
| Account lifecycle | Jetstream `account` events (takedown, deactivation) are ignored, and known accounts are never removed. | Phase 4 |
| Retire legacy auth and write paths | `/auth/*`, `users`, the `videos` table, `POST /videos`, like, view and URL rewrite, and the JWT middleware are still live, though nothing calls them. | Phase 3 Unit 2.5C |
| Bluesky bridge | No bridge code on the backend; the attempt-1 tables are dropped on boot. | Phase 3 Unit 2.5D; [federation](federation.md) |
| Seeder extraction | The seeder still runs in the API process rather than as a separate worker reached over an internal API. | [p2p-torrent](p2p-torrent.md#implementation-status) |
| Own PDS | No PDS is run; users log in against their existing PDS. | [`open-problems/own-pds.md`](open-problems/own-pds.md) |
| Social graph | `follows` table and count triggers exist, with no routes. | Later phase |
| Route tests | Ingest, the feed and blob routes are under test; the legacy routes aren't. | — |

## Decisions behind this

- [Decision 0005 — Backend stays Node + TypeScript; evolves into an AppView](decisions/0005-backend-node-appview.md)
- [Decision 0006 — Migration path from the Swift prototype](decisions/0006-migration-from-swift.md) — phases the legacy feed and email/password backend out (Phases 3–4).
- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md) — login is atproto OAuth; the backend holds no passwords once the legacy path retires.
- [Decision 0017 — The AppView's Postgres is a rebuildable index, one of many](decisions/0017-appview-postgres-is-a-rebuildable-index.md) — Postgres becomes a derived index; clients choose their AppView at runtime.
