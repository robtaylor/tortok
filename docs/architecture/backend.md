# Backend / AppView

*Reference: the current design as it stands in the code. The why lives in the decision records linked from each section; the not-yet-built work is under [Implementation status](#implementation-status). Present tense means "true today". If a claim here is stale, the code moved and this doc didn't.*

The backend (`backend/`) is a single Node + TypeScript Express process backed by Postgres. It is an AppView: it indexes `app.tortok.video.post` records from the network into its own tables ([Decision 0017](decisions/0017-appview-postgres-is-a-rebuildable-index.md)) and serves them as a read-only feed, with their blobs from its own blob route. It also issues TURN credentials. It has no accounts, no auth and no write routes: content reaches it only through atproto. Rationale for staying on Node/TypeScript and growing into an AppView: [Decision 0005](decisions/0005-backend-node-appview.md).

## Process and boot

`backend/src/index.ts` builds the Express app and starts it. The middleware stack is `helmet`, `cors`, JSON and urlencoded body parsers (10 MB limit each), and `morgan` (`combined` in production, `dev` otherwise). CORS allows every origin when `ALLOWED_ORIGINS` is unset or `*`; otherwise it allows the comma-separated list, with credentials.

`start()` runs in order:

1. `initializeDatabase()` applies `db/schema.sql`. A failure here exits the process with code 1.
2. `ingest.start()` starts [atproto ingest](#atproto-ingest). A failure here exits the process with code 1.
3. When `BRIDGE_ENABLED=true`, the [Bluesky bridge](#bluesky-bridge): the firehose, then the poller. A failure here exits the process with code 1. Unset or `false`, the bridge doesn't run; any other value fails boot.
4. `app.listen(PORT)`, default port 8080.

On `SIGTERM` or `SIGINT` the process shuts down once, in order: it stops the HTTP server (closing idle keep-alive connections) while stopping ingest and the bridge (each saves its cursor; the poller finishes its batch), then closes the Postgres pool once in-flight requests have drained, and exits 0. An error in any step exits 1, and an 8-second deadline forces exit 1 if shutdown stalls.

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

- **Feed** (`GET /videos/feed`) returns the indexed `app.tortok.video.post` rows of `posts`, and the bridged `app.bsky.feed.post` rows the engagement poller has qualified, interleaved newest first by the record's `createdAt` (ties by AT-URI), with offset pagination: `limit` (default 20, at most 50) and `offset` (default 0). The response carries `nextCursor` (the next offset as a string, or `null`) and `hasMore`. There is no ranking, following filter or personalisation, and no like or view counts. Each item has:
  - `id` (the AT-URI) and the record `cid`;
  - `author`: DID, `handle` (`null` unless it verified), display name, avatar URL, from the author's `profiles` row. A bridged post whose author has none uses their `bridge_authors` row instead: Bluesky's AppView's handle and display name, and its CDN avatar;
  - `caption`, `hashtags` (each beginning with `#`), `durationSeconds`, `width`, `height`, `createdAt`;
  - `posterURL`, and `playback`, one of two kinds:
    - `kind: 'torrent'` (native posts): the record's `magnetLink`, a `torrentFileUrl`, and `sources: { webseeds, trackers }`, the extra sources the client merges into WebTorrent ([Decision 0022](decisions/0022-clients-learn-extra-video-sources-from-their-appview.md)). `trackers` is `TRACKER_URLS`; `webseeds` is empty, since tortok has no mirrors yet.
    - `kind: 'hls'` (bridged posts): `url`, Bluesky's HLS playlist, played over plain HTTP with no P2P ([Decision 0010](decisions/0010-bluesky-video-bridge.md)). The poster is Bluesky's thumbnail for the video, and `durationSeconds` is 0, since Bluesky records carry no duration.

  A page is read from `idx_posts_feed`, a partial index of the servable rows in feed order whose predicate is the feed query's WHERE clause, so unqualified bridged rows cost a page nothing (0.13 ms for a page at offset 40 over 305,000 bridged rows, measured). The feed is chronological, so an author's `contentVisibilityDeclaration` (out of ranked feeds only, Decision 0023 item 4) doesn't apply yet.

  Native posts' poster, avatar and `.torrent` URLs point at the blob route on `PUBLIC_BASE_URL` (set in `fly.toml`), or on the request's own host when it's unset.
- **Blob** (`GET /blob/:did/:cid`) serves a blob of an author in `profiles`, fetched from the PDS their DID document names (`com.atproto.sync.getBlob`). It checks the bytes against the CID (`atproto/cid.ts`) and returns them with `Cache-Control: public, max-age=31536000, immutable`, so Cloudflare and clients cache them for good. Unknown authors get 404 without any request; blobs over 5 MB get 413; a PDS error is 502, and a timeout (10 s) 504. Only image and `application/x-bittorrent` types pass through; anything else is served as `application/octet-stream` with a sandboxing CSP, so a hostile PDS can't serve a page on this origin.

## Auth

The backend has no auth. Sign-in is atproto OAuth against the user's own PDS, run on the client ([client](client.md#authentication)); the backend holds no accounts or passwords ([Decision 0007](decisions/0007-signup-and-spam-prevention.md)). Every route is public and read-only.

## Database

`backend/src/db/index.ts` owns a single `pg` pool (max 20 connections, 30 s idle timeout, 2 s connect timeout). `DATABASE_URL` defaults to `postgresql://localhost:5432/tortok` outside production. In production the module throws at import time if `DATABASE_URL` is unset. SSL is set only by the URL's `sslmode`; production on Fly connects to `tortok-db.flycast` with `sslmode=disable` over Fly's private network. A pool `error` event exits the process. In development every query is logged with its duration.

**Schema** lives in one file, `db/schema.sql`, applied in full on every boot. There is no migrations directory; changes are idempotent statements appended to that file (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded renames, `DROP … IF EXISTS`). Tables:

| Table | Holds |
|---|---|
| `posts` | Indexed post records, keyed by AT-URI: record CID, caption, duration, dimensions, hashtags, magnet, infohash, and blob CIDs for the thumbnail and `.torrent`. Columns for bridged Bluesky posts: `video_cid` (the feed builds the playlist and thumbnail URLs from it), and the poller's `bridge_checked_at`, `bridge_next_check_at` and `bridge_qualified_at` (which gates serving). Written only by ingest. |
| `bridge_authors` | Authors of bridged posts as Bluesky's AppView describes them: handle (null if `handle.invalid`), display name, CDN avatar URL, follower count, `nobridge` (`#nobridge` in the bio or display name), refresh time. Kept apart from `profiles` so the bridge never overwrites a native author's PDS-verified row. Written by the engagement poller. |
| `labels` | Every atproto label seen, keyed by subject (AT-URI or DID), subject CID (`''` for the whole subject), source and value, with `neg`, `cts` and `exp`. A row changes only for a newer label, so a negation replaces what it negates; a subject's self-labels are replaced as a set, so one the author removes is deleted (`atproto/labels.ts`, Decision 0023 item 2). Policy matches on value alone, which is sound while Bluesky's moderation labeler and self-labels are the only sources; a second labeler needs a trusted-source set beside the value set, since `!hide` and `!takedown` mean something only from a trusted one. Written by the bridge's firehose and poller. |
| `profiles` | Authors: handle (null if it doesn't verify), display name, avatar CID, PDS endpoint, refresh time. |
| `ingest_cursor` | The Jetstream resume cursor. Operator-local: a rebuild needs it. |
| `known_accounts` | DIDs backfilled on boot, with how each became known (`jetstream` or `seed`). Operator-local. |

Everything except the two operator-local tables can be rebuilt from the network (Decision 0017).

The file begins by dropping the legacy native tables (`users`, `videos`, `hashtags`, `video_hashtags`, `follows`, `likes`, `views`) and their trigger functions. Each table goes only while it still has a column only its legacy shape had, so a later table reusing one of those names survives every boot (`__tests__/schema.test.ts`). It also drops the first bridge attempt's tables, `bridged_posts` and `bridge_cursor`. It also drops the `bridged_posts` and `bridge_cursor` tables left by the abandoned first attempt at Phase 3 Unit 2.5. Nothing records views; what a view means is unresolved ([`open-problems/view-counting.md`](open-problems/view-counting.md)).

## atproto ingest

`services/atprotoIngest.ts` indexes `app.tortok.video.post` records into `posts`. It runs in this process, started at boot.

- **Live:** it subscribes to Jetstream (`JETSTREAM_URL`, default `wss://jetstream2.us-east.bsky.network/subscribe`) with `wantedCollections=app.tortok.video.post`, so records from every PDS on the relay arrive as create, update and delete events. The subscription is `services/jetstream.ts`, which the bridge's firehose (below) shares: events are handled one at a time, in order, and it reconnects with backoff from 1 s to 60 s.
- **Cursor:** saved to `ingest_cursor` (key `jetstream`) every 5 s and on shutdown. On reconnect it resumes 5 s before the saved cursor; upserts are idempotent, so replayed events change nothing. The cursor moves only past events that were handled. A handler that throws (a database failure; bad records are skipped without throwing), or a queue more than 5,000 events deep, makes the subscription drop its queue and reconnect, with backoff, from the last event handled, so an outage loses nothing that Jetstream still holds.
- **Validation:** every record passes `atproto/videoPost.ts`, a hand-written check against `lexicons/app/tortok/video/post.json`: required fields, size and grapheme limits, blob MIME types, and a magnet whose infohash matches `infoHash`. An invalid record is skipped; an edit that makes a record invalid deletes the indexed version.
- **Writes:** an upsert keyed by AT-URI replaces a row only when the record CID changes. A delete event deletes the row.
- **Authors:** `atproto/identity.ts` resolves a DID from its own sources, not from Bluesky's AppView. The DID document (PLC directory, or `did:web`'s well-known file) gives the PDS endpoint and the claimed handle. The handle is kept only if its `_atproto` DNS TXT record or `/.well-known/atproto-did` names the same DID. The PDS's `app.bsky.actor.profile` record gives the display name and avatar. Profiles are refreshed when older than 24 hours, and at once on a Jetstream identity event for a known account.
- **Known accounts:** a DID becomes known the first time Jetstream shows it posting a valid record, or from `INGEST_SEED_DIDS` (comma-separated). Production seeds the dev account, `tortok-dev.bsky.social`. `PLC_DIRECTORY_URL` (default `https://plc.directory`) is where `did:plc` documents come from; the e2e stack points it at its own PLC.
- **Backfill:** on boot, each known account's records are re-listed with `com.atproto.repo.listRecords` from its PDS, four accounts at a time. Valid records are upserted, and rows the listing no longer has are deleted, except rows indexed after the listing began.

## Bluesky bridge

Two services, started and stopped together as `services/bskyBridge.ts`, run in this process when `BRIDGE_ENABLED=true` (default off, which also makes it the bridge's off switch; production sets it in `backend/fly.toml`): `services/bskyFirehose.ts` indexes candidates, and `services/bskyEngagementPoller.ts` checks them against Bluesky's AppView and decides which reach the feed (Decisions 0010 and 0023). Which authors are kept out is one rule both apply, `services/bridgePolicy.ts`.

### Firehose


- **Stream:** its own Jetstream subscription for `app.bsky.feed.post` (about 50 events a second), with its own cursor (`ingest_cursor` key `jetstream-bsky-posts`), so the bridge's load and failures stay off native ingest. An hour's measurement on a production-sized machine put it at about 2% of a core (plan 2.5D step 15).
- **Candidates:** `atproto/bskyPost.ts` takes posts with an `app.bsky.embed.video` embed, alone or in `recordWithMedia`, with an aspect ratio of at least `BRIDGE_ASPECT_MIN` (height/width, default 1: square or portrait) and a base32 video CID. A `createdAt` in the future is clamped to now. Hashtags come from `tags` and facet `#tag` features. Everything else is ignored silently.
- **Rows:** a candidate goes in `posts` with `collection = 'app.bsky.feed.post'`, its video CID (the feed's playlist is `<BRIDGE_VIDEO_BASE>/<percent-encoded did>/<cid>/playlist.m3u8`, by default on `https://video.bsky.app/watch`), no magnet, and `bridge_next_check_at` set to now, so the poller takes it next. An upsert changes a row only when the record CID changes, and then clears `bridge_qualified_at` and makes it due again, so an edited post waits for the poller. Delete events remove the row.
- **Labels and drops:** every candidate's self-labels replace its previous ones in `labels`. A post self-labelled with a value in `BRIDGE_NSFW_LABELS` is not indexed, and an edit that adds one removes the row. Nor is a post by an excluded author: `bridge_authors.nobridge`, or a live label in that set or `!no-unauthenticated` on their DID or profile record. A post from an excluded author also removes whatever bridged rows they still have. Both checks read `labels` (`bridgePolicy.ts`), so a label from any writer counts. Author state comes from the poller, so a new author's posts are indexed until it has seen them, but never served before it has checked them.
- **Logging:** counts of posts indexed, dropped as NSFW, dropped as opted out, and rows deleted, every 15 minutes and on stop.

### Engagement poller

- **Queue:** bridged rows with `bridge_next_check_at` due, longest-due first, 25 at a time: a batch every 15 s, or straight away while batches come back full. The next check is half the post's age, between 15 minutes and 24 hours, so a post gets about 14 checks in its first week. A qualified post is re-checked daily until it is `BRIDGE_RECHECK_DAYS` (30) old; then `bridge_next_check_at` is cleared, and it goes only on a Jetstream delete or when its author is found excluded.
- **Reads:** `app.bsky.feed.getPosts` for the batch, and `app.bsky.actor.getProfiles` for authors not refreshed in 24 hours, from `BRIDGE_APPVIEW_URL` (default `https://public.api.bsky.app`), unauthenticated, with no `atproto-accept-labelers` header, so labels are Bluesky's moderation labeler's plus self-labels. An AppView or database error fails the batch, which stays due; batches back off exponentially, up to 30 minutes.
- **Labels:** every post label, and the author labels on both responses, go in `labels`. Self-labels are stored without a record CID, as the firehose stores them, and a profile refresh replaces the author's self-labels as a set, so one the author has removed is deleted at their next refresh.
- **Authors:** each refresh rewrites the `bridge_authors` row. Exclusion is checked once per author per batch, and an author found excluded loses every bridged row at once, due or not, because a row past the recheck age would never be looked at again. Their `app.tortok.video.post` rows are left alone. Exclusion then lasts: the firehose indexes nothing more by them, so no later check re-reads their profile, and removing `#nobridge` or the opt-out label doesn't bring them back.
- **Each post:** it is deleted if the AppView no longer returns it (deleted, taken down, or hidden from logged-out viewers), if it has a live label in `BRIDGE_NSFW_LABELS`, or if its author is excluded. Otherwise it qualifies (`bridge_qualified_at`) at `BRIDGE_MIN_LIKES` likes (default 50), `BRIDGE_MIN_REPOSTS` reposts (10), or an author with `BRIDGE_MIN_FOLLOWERS` followers (5,000). One that hasn't within `BRIDGE_QUALIFY_DAYS` (7) of being posted is deleted. Qualification is never withdrawn on counts, only by the deletion rules.
- **Measured live** (90 s of Jetstream into a throwaway database, then one poll): 37 posts indexed, 4 more dropped as self-labelled NSFW; the poll qualified 4 (authors with 10,000 to 270,000 followers) and dropped 6; 5 of 34 authors had `!no-unauthenticated`.

## Local development

`scripts/dev-up.sh` starts the backend (`npm run dev` on :8080) alongside the local tracker (:8000) and the content server (:8090) from `test-content/`, which seeds the test clips.

## TURN credentials

`GET /turn/credentials` issues coturn time-limited credentials. The username is `<expiry>:tortok` with a 24-hour TTL, and the credential is the base64 HMAC-SHA1 of the username keyed by `TURN_SECRET`. It returns STUN and TURN entries for `tortok-turn.fly.dev:3478`. With `TURN_SECRET` unset it returns the STUN entry only. The TURN server itself is covered in [p2p-torrent](p2p-torrent.md#trackers-and-turn).

## Deployment and configuration

- **Image:** `backend/Dockerfile` is a two-stage `node:22-alpine` build. It runs as a non-root user, copies `schema.sql` next to the compiled `dist/db/`, and health-checks `/health`. The `GIT_SHA` and `BUILD_TIME` build args become environment variables that `/health` reports; an image built without them reports `null`.
- **Fly.io** is the only deployment target. `backend/fly.toml` deploys app `tortok-api` in `lhr` on `shared-cpu-1x` / 512 MB machines. The machine count isn't in `fly.toml`; it's set with `fly scale count` and is 1 (checked 2026-11-09), so there is exactly one Jetstream subscriber. The app forces HTTPS and has a `/health` check. It never auto-stops its machine (`auto_stop_machines = "off"`), because a stopped machine would miss Jetstream events: a gap longer than Jetstream's replay window is lost for accounts that aren't known. It stops machines with `SIGTERM` and a 10 s `kill_timeout`, inside which the 8 s shutdown deadline fits. It answers on `tortok-api.fly.dev` and, publicly, on `appview.tortok.app` (below). Deploys are blue-green (`[deploy] strategy`): Fly starts the new machine beside the old one and moves traffic only once its `/health` check passes. The server listens only after `start()` has reached Postgres and initialised the schema, so an image that can't do either never serves. For the minute or so both run, there are two Jetstream connections; ingest's upserts are idempotent, so the overlap is harmless.
- **Public domain:** `appview.tortok.app` is the AppView's address: clients default to it and the feed's blob URLs use it (`PUBLIC_BASE_URL`). It is a proxied CNAME in Cloudflare's `tortok.app` zone to the Fly app, which holds a Let's Encrypt certificate for the name (`fly certs`, validated through an unproxied `_acme-challenge.appview` CNAME; `_fly-ownership.appview` is the ownership TXT). The zone's SSL mode is Full. A Cache Rule makes `/blob/*` on that host cacheable with the origin's `Cache-Control`, so Cloudflare keeps each blob for a year; everything else (the feed, `/health`) passes through uncached. The zone is on Cloudflare's Free plan, with Bot Fight Mode off (see [Constraints](#constraints)).
- **Deploying:** `npm run deploy:backend` (`scripts/deploy-backend.sh`) deploys only a clean checkout at `origin/main`, passes the commit's SHA and the build time as build args, then runs the smoke check against production expecting that SHA. Deploys are run by hand; nothing deploys on merge, so merging a change to the feed's shape without deploying it makes the scheduled smoke check fail every 15 minutes until production catches up.
- **Smoke check:** `scripts/smoke.mjs <base-url> [--expect-sha <sha>]` is read-only. It checks `/health` (healthy, Postgres reachable, a SHA), the feed and `/turn/credentials` contract (a TURN server with credentials), and, for up to five torrent items, that the `.torrent`'s info hash matches the magnet and that its first and last pieces, fetched from the magnet's webseed with no peers, match the piece hashes. For up to five HLS items it checks the poster and fetches the playlist. Bluesky serves those, so one item failing is a warning, but every checked HLS item failing (a broken URL scheme, or Bluesky refusing us) fails the run. `.github/workflows/smoke.yml` runs it against production every 15 minutes and on demand, then fails if production is missing a backend commit that reached `main` more than a day ago. A failed run emails the repository owner. Its requests come from GitHub's hosted runners, which are in Microsoft's network (AS8075). Its tests (`scripts/smoke.test.mjs`) run in CI against a stub backend serving a real production torrent (`scripts/fixtures/bbb-01.torrent`) and its clip.
- **Reading the production database:** the image has no `psql`. From `backend/`, `fly ssh console -a tortok-api -C "node -e \"…\""` runs a script on the machine, where `new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL })` reaches Postgres. Bridged rows are the `posts` rows with `collection = 'app.bsky.feed.post'`.
- **Environment:** documented in `backend/.env.example`. Required in production: `DATABASE_URL` and `TRACKER_URLS`. Optional with code defaults: `PORT`, `NODE_ENV`, `INSTANCE_DOMAIN`, `ALLOWED_ORIGINS`, `TURN_SECRET`, `JETSTREAM_URL`, `INGEST_SEED_DIDS`, `PLC_DIRECTORY_URL`, `PUBLIC_BASE_URL`, `BRIDGE_ENABLED`, `BRIDGE_NSFW_LABELS`, `BRIDGE_ASPECT_MIN`, `BRIDGE_APPVIEW_URL`, `BRIDGE_MIN_LIKES`, `BRIDGE_MIN_REPOSTS`, `BRIDGE_MIN_FOLLOWERS`, `BRIDGE_QUALIFY_DAYS`, `BRIDGE_RECHECK_DAYS`, `BRIDGE_VIDEO_BASE`, and `TRACKER_URLS` outside production. `TRACKER_URLS` is read by the feed (`config.ts`). `scripts/init-dev-secrets.sh` (run by `dev-up.sh`) fills in `TURN_SECRET` for local development.

## Constraints

- **Record limits** are the Lexicon's, enforced by ingest's validator (`atproto/videoPost.ts`).
- **Request bodies** are capped at 10 MB. Video bytes never pass through the backend; it serves posters, avatars and `.torrent` files only.
- **Single process:** the API, ingest, the bridge and the schema bootstrap share one process, so the API machine is kept always-on for ingest.
- **Bot Fight Mode stays off** on the Cloudflare zones: `tortok.app`, and `tortok.net`, which serves content. It answers clients it takes for bots with a challenge page (HTTP 403) before the request reaches Fly. The AppView's clients are apps and other servers, which can't answer a challenge, and the Free plan can't exempt a path or a client from it short of an IP Access rule. While it was on for `tortok.app`, it challenged every request from GitHub's hosted runners, so the scheduled smoke check failed from 2026-11-12 18:33 UTC until the mode was switched off on 2026-11-13. A deploy's own smoke check didn't show it, because that runs from the deployer's machine. Challenges are listed in the zone's Security Events, in the dashboard only: the API tokens in `.env` can't read them.
- **Tests:** `npm test` runs Jest over `src/__tests__/`. Ingest has integration tests against a real Postgres: each test file creates a throwaway database from `TEST_PG_ADMIN_URL` (default the local server) and applies `schema.sql`; under Jest, `db/index.ts` has no dev default, so a test that loads it before setting `DATABASE_URL` fails instead of using the dev database; with Jetstream, DID resolution and PDS calls stubbed. The feed routes have the same kind of integration test, with records put in through ingest, and so do the bridge's firehose and poller (`bskyFirehose.test.ts`, `bskyEngagementPoller.test.ts`, the AppView stubbed). `bskyBridge.test.ts` runs the two together, with commits arriving as Jetstream messages, and reads the feed route, so it checks what a viewer is served: nothing below the thresholds, labelled NSFW, deleted on Bluesky, or by an author who opted out. The blob route, the CID function (against a real PDS blob), the record validator and the identity resolver have unit tests. CI (`.github/workflows/ci.yml`) runs `tsc` and `npm test` on Node 22 with a Postgres 17 service, on every pull request and every push to `main`.

## Implementation status

**Implemented:**

| Part | Where |
|---|---|
| Feed and single post from indexed records | `backend/src/routes/videos.ts`, `backend/src/services/feedView.ts` |
| Blob route with CID check | `backend/src/routes/blob.ts`, `backend/src/atproto/cid.ts` |
| Postgres pool and boot-time schema | `backend/src/db/index.ts`, `backend/src/db/schema.sql` |
| TURN credential issuance | `backend/src/index.ts` |
| Graceful shutdown (SIGTERM/SIGINT) | `backend/src/index.ts` |
| atproto ingest: Jetstream, backfill, validation, author resolution | `backend/src/services/atprotoIngest.ts`, `backend/src/services/jetstream.ts`, `backend/src/atproto/` |
| Bluesky bridge firehose and engagement poller (booted by `index.ts` behind `BRIDGE_ENABLED`) | `backend/src/services/bskyBridge.ts`, `backend/src/services/bskyFirehose.ts`, `backend/src/services/bskyEngagementPoller.ts`, `backend/src/services/bridgePolicy.ts`, `backend/src/atproto/bskyPost.ts`, `backend/src/atproto/labels.ts` |
| Fly.io deployment, always-on | `backend/Dockerfile`, `backend/fly.toml` |

**Deferred:**

| Part | Gap | Tracking |
|---|---|---|
| Account lifecycle | Jetstream `account` events (takedown, deactivation) are ignored, and known accounts are never removed. | Phase 4 |
| Bluesky bridge: re-reading authors | The poller reads an author's profile only when one of their posts is due. An excluded author has none, so one who removes `#nobridge` or `!no-unauthenticated`, or whose account label is withdrawn, stays out. An author whose posts are all past the recheck age isn't re-read either, so an opt-out they add then goes unseen until they post another video. The recheck age counts from the record's own `createdAt`, so a backdated post that qualifies on its first check is never re-read. | [Decision 0024](decisions/0024-the-bridge-keeps-only-the-posts-it-still-re-reads.md) (Proposed); [Plan 2.5D](../plans/phase-3-atproto.md), the note under step 22 |
| Own PDS | No PDS is run; users log in against their existing PDS. | [`open-problems/own-pds.md`](open-problems/own-pds.md) |
| Social graph | No follows or likes; they will reuse Bluesky's Lexicons. | Later phase |
| View recording | Nothing records views. | [`open-problems/view-counting.md`](open-problems/view-counting.md), Phase 4 |

## Decisions behind this

- [Decision 0005 — Backend stays Node + TypeScript; evolves into an AppView](decisions/0005-backend-node-appview.md)
- [Decision 0006 — Migration path from the Swift prototype](decisions/0006-migration-from-swift.md) — phased the legacy feed and email/password backend out (retired in Phase 3 Unit 2.5C).
- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md) — login is atproto OAuth; the backend holds no passwords.
- [Decision 0017 — The AppView's Postgres is a rebuildable index, one of many](decisions/0017-appview-postgres-is-a-rebuildable-index.md) — Postgres becomes a derived index; clients choose their AppView at runtime.
