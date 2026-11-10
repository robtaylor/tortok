# Backend / AppView

*Reference: the current design as it stands in the code. The why lives in the decision records linked from each section; the not-yet-built work is under [Implementation status](#implementation-status). Present tense means "true today". If a claim here is stale, the code moved and this doc didn't.*

The backend (`backend/`) is a single Node + TypeScript Express process backed by Postgres. Today it serves the **legacy email/password API**: JWT auth, video metadata, the feed, likes and views. It also hosts the origin WebTorrent seeder in-process and issues TURN credentials. It does not yet speak atproto. The AppView it is meant to become is unbuilt: it will read the network's event stream and index `app.tortok.video.*` records ([Decision 0017](decisions/0017-appview-postgres-is-a-rebuildable-index.md)). Rationale for staying on Node/TypeScript and growing into an AppView: [Decision 0005](decisions/0005-backend-node-appview.md).

## Process and boot

`backend/src/index.ts` builds the Express app and starts it. The middleware stack is `helmet`, `cors`, JSON and urlencoded body parsers (10 MB limit each), and `morgan` (`combined` in production, `dev` otherwise). CORS allows every origin when `ALLOWED_ORIGINS` is unset or `*`; otherwise it allows the comma-separated list, with credentials.

`start()` runs in order:

1. `initializeDatabase()` applies `db/schema.sql`. A failure here exits the process with code 1.
2. `seeder.initialize()` starts the WebTorrent seeder. A failure here is logged as a warning and the server **continues without a seeder**.
3. `app.listen(PORT)`, default port 8080.

On `SIGTERM` or `SIGINT` the process shuts down once, in order: it stops the HTTP server (closing idle keep-alive connections) while destroying the seeder client, then closes the Postgres pool once in-flight requests have drained, and exits 0. An error in any step exits 1, and an 8-second deadline forces exit 1 if shutdown stalls.

Unmatched routes return `404 {"error":"Not found"}`. Uncaught route errors return `500 {"error":"Internal server error"}`; the underlying `message` is included only when `NODE_ENV=development`.

## HTTP surface

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/health` | none | `index.ts`: status, timestamp, `INSTANCE_DOMAIN` |
| GET | `/.well-known/tortok` | none | `index.ts`: static instance info (`federationEnabled: false`, `supportedProtocols: ['tortok-v1']`) |
| GET | `/seeder/stats` | none | `index.ts`: seeder torrent/peer counts, upload speed, seeded torrent list |
| GET | `/turn/credentials` | none | `index.ts`: ICE servers (see [TURN credentials](#turn-credentials)) |
| GET | `/content/*` | none | `express.static` over `backend/content/`, with HLS content types and `Access-Control-Allow-Origin: *` |
| POST | `/auth/register` | none | `routes/auth.ts` |
| POST | `/auth/login` | none | `routes/auth.ts` |
| GET | `/auth/me` | JWT required | `routes/auth.ts` |
| POST | `/videos` | JWT required | `routes/videos.ts`: create video + hashtags |
| GET | `/videos/feed` | JWT optional | `routes/videos.ts`: the feed |
| GET | `/videos/:id` | JWT optional | `routes/videos.ts`: one video |
| POST | `/videos/:id/like` | JWT required | `routes/videos.ts`: like / unlike |
| POST | `/videos/:id/view` | JWT optional | `routes/videos.ts`: record a view |
| PATCH | `/videos/:id/urls` | JWT required, owner only | `routes/videos.ts`: rewrite `magnet_link` / `torrent_file_url` |

The Expo client calls `/auth/login`, `/auth/register`, `/auth/me` and `/videos/feed` (`tortok/lib/api.ts`). It resolves the base URL from `EXPO_PUBLIC_API_URL`, falls back to the dev host on port 8080 in development, and uses `https://tortok-api.fly.dev` otherwise.

### Videos and feed

- **Create** (`POST /videos`) inserts the video and its hashtags in one transaction. Hashtags are lowercased and upserted into `hashtags`, incrementing `usage_count`, then linked through `video_hashtags`.
- **Feed** (`GET /videos/feed`) returns every video, newest first (`ORDER BY created_at DESC`), with offset pagination: `limit` (default 20) and `offset` (default 0). The response carries `nextCursor` (the next offset as a string, or `null`) and `hasMore`. There is no ranking, following filter or personalisation. With a valid JWT, each item's `isLiked` reflects the caller's likes; without one it is `false`.
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

Triggers keep `users.follower_count` / `following_count` in step with `follows`, and `users.video_count` in step with `videos`. The file ends by dropping the `bridged_posts` and `bridge_cursor` tables left by the abandoned first attempt at Phase 3 Unit 2.5.

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

- **Image:** `backend/Dockerfile` is a two-stage `node:22-alpine` build. It runs as a non-root user, copies `schema.sql` next to the compiled `dist/db/`, bakes `backend/content/` into the image, and health-checks `/health`.
- **Fly.io** is the only deployment target. `backend/fly.toml` deploys app `tortok-api` in `lhr` on `shared-cpu-1x` / 512 MB machines. The machine count isn't in `fly.toml`; it's set with `fly scale count` and is 1 (checked 2026-11-09), so there is exactly one in-process seeder. The app forces HTTPS and has a `/health` check. It never auto-stops its machine (`auto_stop_machines = "off"`) so the in-process seeder never idles out, and stops machines with `SIGTERM` and a 10 s `kill_timeout`, inside which the 8 s shutdown deadline fits. This is the production URL the client defaults to; it answers `/health` as `tortok-api.fly.dev`.
- **Environment:** documented in `backend/.env.example`. Required: `JWT_SECRET` always; `DATABASE_URL`, `CONTENT_ORIGIN_URL` and `TRACKER_URLS` in production. Optional with code defaults: `PORT`, `NODE_ENV`, `JWT_EXPIRES_IN`, `INSTANCE_DOMAIN`, `INSTANCE_NAME`, `ALLOWED_ORIGINS`, `TURN_SECRET` (plus the two seeder variables outside production). `scripts/init-dev-secrets.sh` (run by `dev-up.sh`) fills in `JWT_SECRET` and `TURN_SECRET` for local development.

## Constraints

- **Video metadata limits** (`schemas.createVideo`): caption ≤ 500 characters; `durationSeconds` 1–300; at most 10 hashtags, each ≤ 50 characters; `magnetLink` must start with `magnet:?`; `posterUrl` must be `https`; `torrentFileUrl` may be `http` or `https`.
- **Accounts:** usernames are alphanumeric, 3–30 characters; display names 1–100 characters.
- **Request bodies** are capped at 10 MB. The backend accepts metadata only; video bytes never pass through it.
- **Single process:** the seeder, the API and the schema bootstrap share one process, so the API machine is also the origin seeder and is kept always-on.
- **Tests:** `npm test` runs Jest over `src/__tests__/`, which holds only a placeholder smoke test. No route, middleware or schema behaviour is under test. CI (`.github/workflows/ci.yml`) runs `tsc` and `npm test` on Node 22 with a Postgres 17 service, on every pull request and every push to `main`.

## Implementation status

**Implemented:**

| Part | Where |
|---|---|
| Legacy email/password auth, JWT issue/verify | `backend/src/routes/auth.ts`, `backend/src/middleware/auth.ts` |
| Request validation | `backend/src/middleware/validate.ts` |
| Video create, feed, single video, like, view, owner-only URL rewrite | `backend/src/routes/videos.ts` |
| Postgres pool and boot-time schema | `backend/src/db/index.ts`, `backend/src/db/schema.sql` |
| In-process origin seeder + stats | `backend/src/services/seeder.ts`, `backend/src/index.ts` |
| TURN credential issuance | `backend/src/index.ts` |
| Graceful shutdown (SIGTERM/SIGINT) | `backend/src/index.ts` |
| Fly.io deployment, always-on | `backend/Dockerfile`, `backend/fly.toml` |

**Deferred:**

| Part | Gap | Tracking |
|---|---|---|
| AppView ingest | Nothing subscribes to or polls a PDS; no `app.tortok.video.post` records are indexed. The planned unified `posts` table and `services/atprotoIngest.ts` do not exist. | [`phase-3-atproto.md`](../plans/phase-3-atproto.md) Unit 2.5A |
| Feed cutover | `/videos/feed` reads the legacy `videos` table, not atproto records. | Phase 3 Unit 2.5B; Phase 4 (Decision 0006) |
| Retire legacy auth and write paths | `/auth/*`, `users`, `POST /videos` and the JWT middleware are still live. | Phase 3 Unit 2.5C |
| Bluesky bridge | No bridge code on the backend; the attempt-1 tables are dropped on boot. | Phase 3 Unit 2.5D; [federation](federation.md) |
| Seeder extraction | The seeder still runs in the API process rather than as a separate worker reached over an internal API. | [p2p-torrent](p2p-torrent.md#implementation-status) |
| Own PDS | No PDS is run; users log in against their existing PDS. | [`open-problems/own-pds.md`](open-problems/own-pds.md) |
| Social graph | `follows` table and count triggers exist, with no routes. | Later phase |
| Tests | Placeholder smoke test only. | — |

## Decisions behind this

- [Decision 0005 — Backend stays Node + TypeScript; evolves into an AppView](decisions/0005-backend-node-appview.md)
- [Decision 0006 — Migration path from the Swift prototype](decisions/0006-migration-from-swift.md) — phases the legacy feed and email/password backend out (Phases 3–4).
- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md) — login is atproto OAuth; the backend holds no passwords once the legacy path retires.
- [Decision 0017 — The AppView's Postgres is a rebuildable index, one of many](decisions/0017-appview-postgres-is-a-rebuildable-index.md) — Postgres becomes a derived index; clients choose their AppView at runtime.
