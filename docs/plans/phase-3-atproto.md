# Phase 3 — atproto integration

**Status:** Active — the current phase (Decision 0006 Phase 3).

## Status (2026-11-10)

- ✅ **Unit 0** — Decision 0012 (Lexicon namespace governance) merged; canonical NSID is **`app.tortok.*`** (reverse-DNS rooted at `tortok.app`); schema lives at `lexicons/app/tortok/video/post.json`; AppView+PDS cost note added to Deferred Decisions in [`open-problems/README.md`](../architecture/open-problems/README.md).
- ✅ **Unit 1** — Standalone Node smoke test (`scripts/atproto-smoke-test.mjs`) round-trips an `app.tortok.video.post` record against `bsky.social` using app-password auth.
- ✅ **Unit 2** — OAuth round-trip verified end to end on the iOS simulator (2026-05-02). Android and web haven't been verified. `tortok.app` is live on Cloudflare Pages, `@atproto/oauth-client-expo` is integrated, the Hermes polyfills are in `tortok/lib/polyfills.ts`, the login screen pre-fills the last handle, and the auth store has 7 unit tests.
- ➡️ **Unit 2.5** — replanned 2026-05-02 after a failed first attempt, rescoped 2026-11-09. Step 2.5-0 (cleanup) is done; 2.5A (ingest) is next. Its sub-phases run 2.5-0 → 2.5A ingest → 2.5B feed cutover → 2.5C retire legacy → 2.5D Bluesky bridge → 2.5E final checks. It absorbs Units 4 (mostly), 5 and 6.
- **Unit 3** — after Unit 2.5; the client publishes `app.tortok.video.post` via the user's PDS.
- **Unit 7** — web cookie auth, not started.
- ✅ **Moderation parallel track** — Decision 0013 landed 2026-04-29 (atproto labelers + illegal-content floor + UK age-verification gate); `open-problems/moderation.md` deleted.

**Naming.** Decisions 0016 and 0017 were written before the sub-phases were renamed, and call them "Phase A" to "Phase C". Their "Phase C" is 2.5C here. The release stages in [`release-plan.md`](release-plan.md) are Beta, Ramp and 1.0, so no letter means two things.

## Context

Phase 2 (cross-platform P2P) signed off 2026-04-29 with a two-iOS-sim
test measuring 89–91% P2P offload between two peers. Phase 3 is now
the active phase.

The original Phase 3 scope was to fork our own atproto PDS, sign users
up custodially and migrate them. That was reversed on 2026-04-29; see
[`open-problems/own-pds.md`](../architecture/open-problems/own-pds.md).
Phase 3 now uses users' existing atproto identities (typically
`bsky.social`) and is much smaller.

## Settled before the work started

Three of the four working answers from the 2026-04-29 kickoff are now
decision records:

- **AppView ingest reads the network.** [Decision 0017](../architecture/decisions/0017-appview-postgres-is-a-rebuildable-index.md)
  (item 3) has the AppView read the relay through Jetstream. This
  replaced the kickoff answer of polling known PDS hosts.
- **The social graph reuses Bluesky's Lexicons.** Follows and likes are
  `app.bsky.graph.follow` and `app.bsky.feed.like` records
  ([Decision 0012](../architecture/decisions/0012-lexicon-namespace.md), item 3).
- **Postgres is a rebuildable index.** The legacy tables go; `posts`
  indexes records from users' repos, and only a short named list is
  operator-local ([Decision 0017](../architecture/decisions/0017-appview-postgres-is-a-rebuildable-index.md),
  items 1 and 2).

One is plan scope rather than a decision: **Phase 3 ships no likes or
follows.** The feed is read-only. The social graph comes in a later
phase.

## Units

Each unit is independently shippable / mergeable. Sizes are
gut-feeling estimates, not commitments.

### Unit 0 — Pre-work *(decisions, ~half day)* ✅ DONE 2026-04-29

- **decision record: Lexicon namespace governance.** ✅ Decision 0012. Canonical NSID
  prefix is `app.tortok.*` (reverse-DNS rooted at `tortok.app`, matching
  the `app.bsky.*` convention). Schema repo layout, Bluesky-shape reuse
  policy documented.
- **`lexicons/app/tortok/video/post.json`.** ✅ Live. Shape diverged
  from the Decision 0002 draft in two ways worth noting:
  - `aspectRatio` is `{width, height}` (matching
    `app.bsky.embed.defs#aspectRatio`), not the draft's `"9:16"` string —
    interop with Decision 0010 inbound bridge.
  - The shape is **inlined**, not `ref`'d to `app.bsky.embed.defs`,
    avoiding a runtime dependency on Bluesky lexicons being loaded in
    our validator.
- **AppView + PDS cost back-of-envelope.** ✅ Added to
  the Deferred Decisions in `open-problems/README.md`.

### Unit 1 — Round-trip smoke test *(out-of-app, ~half day)* ✅ DONE 2026-04-30

Standalone Node script (`scripts/atproto-smoke-test.mjs`): app-password
login → create an `app.tortok.video.post` record against `bsky.social`.
Run via `npm run smoke:atproto`.

**Verified:**
- `bsky.social` accepts third-party `app.tortok.*` lexicons.
- App-password auth bypasses OAuth's browser-redirect requirement
  (correct for unattended scripts; production app uses OAuth in Unit 2).
- Result: `at://did:plc:teqobv6pqer5nw7roqrgi55v/app.tortok.video.post/3mkphgk54ta2h`.

**Notes for Unit 2:**
- `bsky.social` `createSession` is rate-limited to 10/day/account
  (header `ratelimit-policy: 10;w=86400`). Iterative OAuth dev will
  hit this fast — plan to cache sessions, or have a second test handle.
- Blob upload was deferred (the smoke test creates a record without
  a thumbnail blob); blob-size sanity check rolls into Unit 3.


### Unit 2 — Client OAuth login *(~2–3 days; revised 2026-05-01)* ✅ DONE 2026-05-02 (iOS)

**Library choice (revised).** The original plan called for
`expo-auth-session`. That was wrong: atproto OAuth requires PAR
(Pushed Authorization Requests) and DPoP (Demonstrating
Proof-of-Possession), neither of which `expo-auth-session` supports.

Use **`@atproto/oauth-client-expo`** instead — official Bluesky
package, currently `0.0.10` (pub 2026-02-20), maintained by the atproto
OAuth lead (Matthieu Sieben). Wraps the same `@atproto/oauth-client`
core as `oauth-client-browser`, adds a native Expo crypto module
(DPoP key generation), drives `expo-web-browser`'s
`openAuthSessionAsync` (ASWebAuthenticationSession on iOS / Custom
Tabs on Android), persists state + sessions in `react-native-mmkv`.
Web target falls through to `oauth-client-browser`'s top-level redirect.

```bash
npx expo install @atproto/oauth-client-expo @atproto/api expo-web-browser react-native-mmkv react-native-url-polyfill
```

#### Prereqs (must land before any device install talks to a real PDS)

1. **Stand up `tortok.app` static hosting.** atproto OAuth requires
   the `client_id` to literally **be** the URL of a hosted JSON file
   — typically `https://tortok.app/.well-known/oauth-client-metadata.json`.
   Until this is live, OAuth cannot complete against a real PDS.
   Reference shape: `https://skylight.expo.app/oauth/client-metadata.json`
   (Skylight is the canonical live example since Bluesky's own RN
   client doesn't yet use OAuth — see "Reference apps" below).
   - Resolved: Cloudflare Pages serves `web/public/` at `tortok.app`
     (`scripts/deploy-web.sh`).
   - Web build's redirect URI also needs to live on `tortok.app`
     (e.g. `https://tortok.app/auth/callback`), so this hosting needs
     a small `auth/callback` route or a static page that calls
     `oauth.handleCallback()`.
2. **The Expo client is prebuilt** (custom dev client, not Expo Go),
   which MMKV requires. Phase 2's WebTorrent work had already forced
   this.
3. **Native deep-link scheme.** `app.config.ts` `scheme:
   "app.tortok"` (reverse-DNS of the metadata host, **single slash**
   in the URI: `app.tortok:/auth/callback`, not `app.tortok://`).

#### Implementation cut

- **Client metadata file** at `tortok/assets/oauth-client-metadata.json`
  (bundled) and at `tortok.app/.well-known/oauth-client-metadata.json`
  (hosted) — same content. Scope: `atproto transition:generic`
  (Permission Sets are still in flux per discussion #4437; don't
  adopt yet). `redirect_uris` includes both `app.tortok:/auth/callback`
  and `https://tortok.app/auth/callback`.
- **Single client instance** at app start
  (`tortok/lib/atproto/oauth.ts`), `new ExpoOAuthClient({
  handleResolver: 'https://bsky.social', clientMetadata })`.
- **New login screen** replaces `tortok/app/(auth)/login.tsx`. User
  enters a handle (or PDS host) → `await oauth.signIn(handle)` →
  resolves to an `OAuthSession`.
- **Auth store integration.** `tortok/stores/auth.ts` stays zustand
  but its `token: string | null` shape no longer maps cleanly onto
  an `OAuthSession`. Two options:
  - **(a)** Replace `token` + `user` with `did: string | null`, store
    only the DID, restore the live `OAuthSession` from
    `oauth.restore(did)` on every cold start. Cleaner.
  - **(b)** Keep `token` + `user` for legacy backend compat during
    Unit 2 → 3 transition; add `did` alongside; remove the legacy
    fields in Unit 2.5C.
  - Pick **(b)** for Unit 2 scope (less churn, no legacy-API breakage
    yet).
- **Logout** = `await session.signOut()` (revokes server-side) +
  drop the DID from the store.

#### Risks

- **Pre-1.0 lib.** `0.0.10`, sub-fortnightly cadence, single primary
  maintainer. Pin a version, watch the CHANGELOG. Decision 0012's vendor-risk
  caveat applies here too.
- **No first-party reference.** Bluesky's own `social-app` still uses
  App Passwords (`agent.login(identifier, password)` —
  `social-app/src/state/session/agent.ts:109`); they have not yet
  cut over to OAuth in their RN client. Few public Expo apps do
  this.
- **Single-use refresh tokens** mean concurrent XRPC calls from two
  stale `Agent` instances over the same session can race. The core
  has locking; just don't construct multiple agents for one session.
- **Rate limit during dev.** `tortok-dev.bsky.social` is 10
  logins/day/account. OAuth flows count against this. Cache sessions
  aggressively in dev.

**Done =** "Sign in with Bluesky" works on iOS simulator, Android
emulator, and web. Logged-in DID visible in app state. Cold start
restores the session via `oauth.restore(did)`. Logout revokes. Only
the iOS simulator was verified (2026-05-02); Android and web are
unverified.

### Unit 2.5 — Atproto-native cutover + Bluesky bridge *(~5–7 days; replanned 2026-05-02, rescoped 2026-11-09)*

Six months passed between the replan and its execution. The user
confirmed the rescoped version on 2026-11-09; their answers to the four
open questions are under [Decisions on the open questions](#decisions-on-the-open-questions-user-2026-11-09)
at the end of this unit, and the steps below already reflect them.

**State on 2026-11-09.**

- **2.5-0 is done.** `schema.sql` already drops `bridged_posts` and
  `bridge_cursor`; the R2 `bridged/` prefix is empty (checked); no
  attempt-1 services exist in `backend/src/services/` (only `seeder.ts`).
- **2.5A hasn't started.** No `posts` table, no `atprotoIngest`, no
  `seed-fixtures.mjs`.
- **The test account holds one record,** the 2026-04-30 smoke-test post,
  whose magnet points at `ws://localhost:8000` and
  `http://localhost:8090/bbb-01.mp4`. It's unplayable from anywhere but a
  dev machine, and shows why sources baked into signed records matter.
- **The client is broken by the half-done cutover** (see
  [`client.md`](../architecture/client.md#implementation-status)): after
  OAuth login the feed never loads, Like is a no-op, Profile is blank
  (hiding sign-out), and the Detox login helper targets fields that no
  longer exist. 2.5B and 2.5C fix this.
- **Content** is served from `content.tortok.net`; production's feed is the
  five BBB clips in the legacy `videos` table, published by
  `scripts/seed-prod-test-content.mjs` (same infohashes as the dev clips).

**Why a replan.** The first attempt (preserved on the
`unit-2.5-attempt-1` tag, ~30 commits) shipped `bridged_posts` as a
sidecar table with a `source: 'tortok' | 'bsky'` discriminator on the
feed. Each debugging round revealed the same misalignment: it built
toward an architecture (legacy native flow + bridged sidecar) that
Units 4, 5 and 6 were going to demolish anyway. Bisecting to `670061a`
(pre-Unit-2.5) showed that the `bridge.native.ts` and
WebTorrent-on-Hermes infrastructure is fine. The slow plays and R2 429s
were data-shape problems, not platform problems. Coding was the easy
part: the day was 80% problem identification. The replan builds the
end state directly.

**End state.**

- One `posts` table holding atproto records of either Lexicon
  (`app.tortok.video.post`, or `app.bsky.feed.post` with a video
  embed). The at-uri's collection segment is the discriminator, so
  there's no `source` column.
- Federation-equal rendering: a row is a row. The client treats
  `app.tortok.*` and `app.bsky.*` posts the same, apart from the
  canonical-link target (tortok.app vs bsky.app), an optional "via
  Bluesky" badge, and how they play (bridged posts play Bluesky's HLS
  URL; see 2.5D).
- The legacy native auth and write paths are gone (absorbed Units 5
  and 6).

#### 2.5-0 — Cleanup ✅ DONE

`backend/src/db/schema.sql` ends with `DROP TABLE IF EXISTS` for the
attempt-1 tables `bridged_posts` and `bridge_cursor`. The DROPs stay in
the file permanently: they're idempotent and the names won't be reused.
The R2 `bridged/` prefix is empty and no attempt-1 services survive.

#### 2.5A — Atproto-native ingestion (~1.5–2 days)

Goal: tortok-native posts, created by Unit 3 or by `seed-fixtures.mjs`,
flow into a unified `posts` table that the feed reads from. The legacy
`videos` table still exists at the end of this phase; 2.5C drops it.

0. **Lexicon first** ([Decision 0020](../architecture/decisions/0020-torrent-metadata-as-pds-blob.md)):
   add the optional `torrentBlob` and drop `hlsFallbackUrl`, so the
   fixtures are published with their `.torrent` from the start.

1. **Append the `posts` table to `backend/src/db/schema.sql`:**
   ```sql
   CREATE TABLE IF NOT EXISTS posts (
     at_uri TEXT PRIMARY KEY,            -- at://did/collection/rkey
     did TEXT NOT NULL,
     collection TEXT NOT NULL,           -- 'app.tortok.video.post' | 'app.bsky.feed.post'
     rkey TEXT NOT NULL,
     cid TEXT NOT NULL,                  -- record CID (for revision tracking)
     -- Content
     text TEXT,
     video_cid TEXT,                     -- the video blob's CID
     thumbnail_cid TEXT,                 -- poster blob; URL built at read time
     duration_ms INTEGER,
     width INTEGER,                      -- the record's aspectRatio
     height INTEGER,
     hashtags TEXT[],
     -- Playback: magnet for app.tortok rows, hls_url for app.bsky rows
     magnet_link TEXT,
     info_hash TEXT,
     torrent_cid TEXT,                   -- torrentBlob (Decision 0020)
     hls_url TEXT,
     -- Lifecycle
     record_created_at TIMESTAMPTZ NOT NULL,
     indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS idx_posts_collection_created
     ON posts (collection, record_created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_posts_did ON posts (did);
   ```
   `collection` is already part of `at_uri`; the column is a
   denormalized index helper. Posts store blob CIDs, not URLs: the feed
   builds URLs on the AppView's blob route (step 5).

   Alongside it, append:
   - **`profiles`**: DID, handle, display name, avatar CID, PDS endpoint
     and refreshed-at. Feed reads join it, so a profile change updates
     one row. The PDS endpoint is needed to fetch blobs.
   - **`ingest_cursor`** and **`known_accounts`**, the operator-local
     tables of Decision 0017 item 2. `known_accounts` records how each
     DID became known (seen on Jetstream, or from the env seed list).

2. **Create `backend/src/services/atprotoIngest.ts`.**
   - Subscribe to Jetstream with `wantedCollections=app.tortok.video.post`,
     so new, updated and deleted records arrive as events. Attempt 1 ran a
     Jetstream subscriber (`wss://jetstream2.us-east.bsky.network/subscribe`)
     with a persisted cursor; reuse that shape. Jetstream carries records
     from every PDS on the relay, so ingest isn't limited to `bsky.social`.
   - Validate each record against the Lexicon before indexing: required
     fields, size limits, and a magnet whose infohash matches `infoHash`.
     A hand-written validator for this one record type, with tests.
   - Resolve each author from the source, not from Bluesky's AppView: the
     DID document (PLC directory or `did:web`) gives the handle and PDS,
     and the PDS's `app.bsky.actor.profile` record gives the rest.
   - UPSERT into `posts` keyed by `at_uri`; replace a row only when its
     `cid` changed. Delete events DELETE by `at_uri`. Tombstones are a
     Phase 4 concern.
   - Backfill with `com.atproto.repo.listRecords` for each account in the
     known-account list, on boot and when an account is added. Decision
     0017 (item 2) makes that list operator-local data the rebuild depends
     on, so persist it, and persist the Jetstream cursor.
   - Save the cursor every few seconds, and rewind a few seconds on
     reconnect; the idempotent upsert absorbs the replay.
   - Boot it from `backend/src/index.ts`. Use the `ws` package: the
     Docker image is `node:18-alpine`, which has no global WebSocket.
     Upgrade Node after 2.5C removes the seeder's native dependencies.

3. **Create `scripts/seed-fixtures.mjs`.** It publishes the five BBB clips
   as `app.tortok.video.post` records from `tortok-dev.bsky.social`.
   - It reuses the torrent logic of `seed-prod-test-content.mjs`: same
     infohashes, `content.tortok.net` webseeds, the poster uploaded as
     the thumbnail blob, and the `.torrent` uploaded as `torrentBlob`.
   - It uses app-password auth and caches the session, because the account
     allows 10 logins a day.
   - It's idempotent: records that already exist are skipped.
   - It deletes the 2026-04-30 localhost smoke-test record.

4. **Integration tests** for ingest against a real Postgres, with fixtures
   for both `app.tortok.video.post` and bridged `app.bsky.feed.post`
   shapes (Decision 0016, commitment 2).

**Done =** running `seed-fixtures.mjs` publishes five records; within
seconds the ingest worker has copied them to `posts`, and
`SELECT * FROM posts WHERE collection = 'app.tortok.video.post'`
returns those five rows. Restarting the backend with an empty `posts`
table refills it from backfill.

#### 2.5B — Feed cutover + client fixes (~1 day)

Goal: the feed reads `posts`, not `videos`, and the client works after
OAuth login. The legacy write routes still exist but nothing calls
them.

5. **Modify `backend/src/routes/videos.ts`.**
   - `GET /videos/feed` reads `posts ORDER BY record_created_at DESC`.
   - Mapping: `at_uri → id`, `profiles` → `user.*`,
     `magnet_link/hls_url → playback`, and `thumbnail_cid`,
     `torrent_cid` and the avatar CID → URLs on the blob route below.
   - `GET /videos/:id` likewise reads `posts`.
   - **Blob route** `GET /blob/:did/:cid`: fetch the blob once from the
     author's PDS and return it with `Cache-Control: immutable`, so
     Cloudflare caches it for good. A CID names its content, so the
     cache can't go stale. It serves posters, avatars and `.torrent`
     files, keeping images on a CDN as the legacy R2 posters are today.

6. **Runtime sources** (the Phase 3 requirement in
   [`cross-deployment-transport.md`](../architecture/open-problems/cross-deployment-transport.md)).
   Each feed item carries a `sources` object beyond its magnet, holding
   extra webseed URLs and extra tracker URLs. The AppView fills it for
   content it can serve, from `CONTENT_ORIGIN_URL` and its tracker list.
   The client passes them to WebTorrent's
   `client.add(magnet, { urlList, announce })`, which merges them with the
   magnet's own webseeds and trackers (WebTorrent 2.8.5, `lib/torrent.js`).
   - Extra webseeds let a client fetch bytes from an origin the publisher
     didn't name, such as this AppView's content origin or a mirror.
   - Extra trackers let it find peers that announce to a different
     tracker. Without them, clients of two deployments with their own
     trackers never find each other, because the DHT is off.

   Real user records arrive in Unit 3, so this must land before Unit 3.

7. **Client.**
   - The feed query stops depending on the legacy token; the feed
     endpoint is public.
   - Profile renders the OAuth handle and DID, with a sign-out button.
   - The Like button is hidden, since Phase 3 ships no likes.
   - `tortok/lib/api.ts` types follow any renamed response fields.

**Done =** after OAuth login on the iOS simulator, the feed shows the
seeded records and plays them through WebTorrent, and sign-out works
from Profile.

#### 2.5C — Retire the legacy native flow (~1 day)

Goal: drop the auth and write surface that's been dead since 2.5B.
Afterwards the only way content reaches the app is through atproto.

8. **Backend.** Delete `routes/auth.ts`, the JWT bearer path in
   `middleware/auth.ts`, the legacy write routes in `routes/videos.ts`
   (`POST /videos`, `POST /videos/:id/like`, `POST /videos/:id/view`,
   `PATCH /videos/:id/urls`) and `/.well-known/tortok`, which also leaves
   Decision 0016's smoke contract (Decision 0017, item 6).
9. **Seeder.** Remove `SeederService` (`services/seeder.ts`), the
   `/seeder/stats` route and the `backend/content/tortok-test-video`
   fixture, and set `fly.toml` back to `auto_stop_machines = "stop"`
   (decision 1 below). Update `p2p-torrent.md` and `backend.md` in the same
   change.
10. **Schema.** Append DROPs for `users`, `videos`, `hashtags`,
    `video_hashtags`, `follows` and `likes` to `schema.sql`. Keep `views`.
11. **Client.** Delete `app/(auth)/register.tsx`; the auth store's `token`,
    `user` and legacy `signIn`; and `lib/api.ts`'s legacy calls and types.
12. **Detox.** The `login()` helper moves to the dev-only app-password
    sign-in (decision 3 below) in the same change (Decision 0016,
    commitment 6).
13. **AppView URL setting.** An in-app AppView base-URL setting,
    defaulting to tortok's, replaces the build-time `EXPO_PUBLIC_API_URL`
    (decision 4 below).
14. **AppView custom domain.** Serve the `tortok-api` Fly app as
    `appview.tortok.app`: a Fly certificate plus a DNS record in the
    Cloudflare `tortok.app` zone, **proxied** through Cloudflare so the
   blob route is cached at the edge. The URL setting's default is that
    domain, so `tortok-api.fly.dev` never ships in a user build. The Fly
    app keeps its name; nothing user-facing shows it. The domain is on
    `tortok.app`, not `tortok.net`, because the AppView is part of the
    app and `tortok.net` is kept for content. It also gives the later
    service DID a stable host (`did:web:appview.tortok.app`). Decided
    with the user on 2026-11-10, along with keeping ingest in the
    `tortok-api` process until it needs to scale on its own.

**Removal checklist** (checked against the code 2026-11-09; each item is
unused once 2.5B and 2.5C land, unless noted):

- Backend code: `routes/auth.ts`; `middleware/auth.ts` (JWT bearer path);
  `middleware/validate.ts` and its Joi schemas, if no surviving route
  validates input; the legacy write routes in `routes/videos.ts`;
  `/.well-known/tortok`; `services/seeder.ts`, `/seeder/stats` and the
  `backend/content/tortok-test-video` fixture.
- Backend dependencies: `bcrypt`, `jsonwebtoken`, `joi` (with
  `validate.ts`), `webtorrent` (with the seeder), and their `@types/*`.
  `uuid` is already unused and can go in any change.
- Backend config: `JWT_SECRET` (code, `.env.example`,
  `scripts/init-dev-secrets.sh`); `TRACKER_URLS` (seeder only);
  `kill_timeout`/`auto_stop_machines = "off"` in `fly.toml` revert to
  scale-to-zero. `CONTENT_ORIGIN_URL` stays: 2.5B's `sources` use it.
- Schema: the six legacy tables (step 10).
- Client: `app/(auth)/register.tsx`; the auth store's `token`, `user`
  and legacy `signIn`; `lib/api.ts`'s `login`, `register`, `likeVideo`,
  `recordView`, `getProfile` and the `User`/`AuthResponse` types; the
  Like button (hidden in 2.5B, removed here); the Comment and Share
  buttons, which have no handlers.
- Tests: Detox `auth.test.ts` sign-up cases and every use of
  `emailTextField`, `passwordTextField` and `signUpButton`.
- Scripts: `scripts/seed-prod-test-content.mjs` and
  `test-content/seed-db.mjs` (both write the legacy `videos` table;
  `seed-fixtures.mjs` replaces them); `scripts/atproto-smoke-test.mjs`
  (superseded by `seed-fixtures.mjs`); `scripts/r2-smoke-test.mjs`
  (written for the Phase 0b seeder).
- Docs: `CLAUDE.md` and `open-problems/README.md` used to say the Phase 1
  feed shipped with react-native-video; it never did. Both are fixed;
  re-check nothing else repeats it.
- Kept: `test-content/tracker.mjs` (local tracker for dev);
  `scripts/webseed-only-test.mjs` until WS2's smoke script generalises
  it.

**Views.** Removing `POST /videos/:id/view` loses nothing today, because
the client never calls `recordView`. Nothing records views between
2.5C and the `sendInteractions` approach that
[`view-counting.md`](../architecture/open-problems/view-counting.md)
currently leans towards. That gap is accepted: nothing ranks on views
yet, and Decision 0017's off-Fly backup of view data only matters once
views are recorded again, which is Phase 4.

**Done =** `grep -rn 'JWT_SECRET\|bcrypt\|jsonwebtoken' backend/src`
returns nothing. The backend boots without `JWT_SECRET`, and the app
still works end to end against 2.5B's feed.

#### 2.5D — Bring back the bridge (~1.5 days)

Goal: bridged Bluesky video posts appear in the feed as `posts` rows,
keeping Decision 0010 as written: they play from Bluesky's HLS URL over
plain HTTP, with no P2P and no re-hosting (decision 2 below).

14. **Create `backend/src/services/bskyFirehose.ts`**, ported from attempt
    1: a Jetstream subscriber for `app.bsky.feed.post` with video embeds,
    the NSFW self-label filter (`porn|sexual|nudity|graphic-media|gore`),
    the aspect-ratio filter, opt-out filtering and cursor persistence.
    Matching posts are written to `posts` with `collection =
    'app.bsky.feed.post'`, `hls_url` set and no magnet.
15. **Create `backend/src/services/bskyEngagementPoller.ts`**, ported from
    attempt 1: batches of 25 against `app.bsky.feed.getPosts`, promotion
    thresholds, and NSFW labeler aggregation per Bluesky's default labeler
    set. It removes rows that are retro-labelled.
16. **Client.**
    - An item with `hls_url` and no magnet plays the HLS URL directly
      through `expo-video`, bypassing `useP2PUrl`.
    - A "via Bluesky" badge when the `at_uri` is an `app.bsky.feed.post`.
    - Tap-through to the post on Bluesky, using the rkey from the at-uri.
17. **Boot** `bskyFirehose` and `bskyEngagementPoller` from
    `backend/src/index.ts` alongside `atprotoIngest`. One process for v1.

The attempt-1 mirror pipeline doesn't come back: no R2 mirror, no
ffmpeg remux, no `mirror_state` table, no `bridged/` R2 layout and no
backend `/torrents` route.

**Done =** the Jetstream subscriber connects, the filters fire and NSFW
posts are dropped. The feed shows native and bridged posts interleaved
by `record_created_at`, and the iOS simulator plays both.

#### 2.5E — Final checks (~half day)

18. **End-to-end run.** Drop the dev database, boot the backend clean, run
    `seed-fixtures.mjs`, let the bridge run for about 10 minutes, and
    scroll the iOS simulator feed through native and bridged rows without
    errors.
19. **Write the area docs.** `auth-signup.md` and `federation.md` are
    written in full after the cutover (the area-doc backfill deferred
    them to here). `federation.md` records that bridged posts live in
    `posts` beside native ones, discriminated by collection NSID.
20. **The `unit-2.5-attempt-1` tag** stays or goes; the user decides.
21. **Phase status.** Update the `CLAUDE.md` phases table and this plan's
    status for Units 4–6 absorbed.

**Done =** Phase 3 moves on to Unit 3 with the atproto-native data
layer, the legacy flow retired and the bridge working.

#### What carries forward from attempt 1

All preserved on the `unit-2.5-attempt-1` tag:

- NSFW self-label filter and Bluesky default-labeler aggregation.
- WebTorrent listener leak fix (use `.once()` for the done event,
  capture and remove the error listener, `setMaxListeners(50)`).
- Lazy-init OAuth client, so it survives the Expo Router SSR pass.
- Hermes polyfills (`AbortSignal.timeout`,
  `AbortSignal.prototype.throwIfAborted`).
- Per-segment URL encoding in `bridge.native.ts` (commit 608222b).
- Per-request bridge logging (commit 25a2ef7).

#### What doesn't carry forward

- The `bridged_posts` table and the `source` discriminator column.
- The `videos` ⊕ `bridged_posts` UNION in the feed query.
- The HLS → MP4 remux, R2 mirroring and 16 KB bridged pieces (no
  re-hosting under decision 2). Piece size for tortok's own content is
  still open; see the transport open problem's constraints.

#### Risks

- **2.5B cutover cliff.** The feed switches from `videos` to `posts` in
  one go. 2.5A fills `posts` from fixtures before 2.5B flips the read
  path, so a broken 2.5A stops the cutover.
- **Schema change on the dev and production databases.** 2.5C drops six
  tables. Production holds only the five test clips and test accounts,
  and `seed-fixtures.mjs` republishes the clips as records.
- **Test PDS rate limits.** `tortok-dev.bsky.social` allows 10 logins a
  day. `seed-fixtures.mjs` and the Detox sign-in cache one session. The
  engagement poller hits the public AppView without auth, which is
  rate-limited too; use attempt 1's backoff.

#### Decisions on the open questions (user, 2026-11-09)

1. **Seeder: remove it.** 2.5C deletes `SeederService`, its
   `backend/content/` fixture and the `/seeder/stats` route, and sets the
   API back to `auto_stop_machines = "stop"`. Whether tortok runs an
   always-on peer is now wholly a question for
   [`cross-deployment-transport.md`](../architecture/open-problems/cross-deployment-transport.md).
2. **Bridge: keep Decision 0010.** Bridged posts play from Bluesky's HLS
   URL over plain HTTP, with no P2P and no re-hosting. `posts` rows for
   `app.bsky.feed.post` carry the HLS URL in `hls_url`, and the client
   plays it directly.
3. **Detox: dev-only app-password sign-in.** A sign-in path compiled
   only into dev and e2e builds creates a session for `tortok-dev` from
   its app password, cached to respect the 10 logins/day limit; release
   builds don't contain it. The real OAuth flow gets its own small suite
   per platform later, using a tool that can drive system dialogs and web
   content (Maestro or Appium), run nightly or by hand. Driving the auth
   browser from the main suite was rejected as fragile: the sheet runs out
   of process with a system consent prompt, the login page is Bluesky's
   and can change or add captcha/2FA, every run burns rate-limited
   logins, browser cookies leak state between runs, Android Custom Tabs
   need different automation, and every run depends on live `bsky.social`.
4. **AppView choice: URL setting now, DID later.** 2.5C adds an in-app
   AppView base-URL setting. Service-DID plus PDS-proxy routing becomes
   its own unit after Unit 3.

**Out of scope for this unit:** service-DID AppView routing, publishing
from the app (Unit 3), web cookie auth (Unit 7).

### Unit 3 — Client publishes via PDS *(~1–2 days)*

- Video upload flow: generate the magnet → upload the thumbnail blob via
  the user's PDS → create an `app.tortok.video.post` record.
- The legacy `POST /videos` route is gone after 2.5C; the client only
  writes via the PDS.
- Hashtags travel inside the record (already in the Lexicon shape).
- Once the record lands in the user's PDS, 2.5A's `atprotoIngest`
  receives it from Jetstream and inserts it into `posts`.
- Upload the `.torrent` as `torrentBlob` alongside the thumbnail
  (Decision 0020).
- Before the first real record: settle the piece size and content key
  layout for real uploads, both listed under the constraints in
  [`cross-deployment-transport.md`](../architecture/open-problems/cross-deployment-transport.md),
  because published records can't be changed.

**Done =** posting from the app produces a record in the user's PDS
repo, visible in Bluesky's web UI or an atproto inspector, and the same
record appears in the feed within seconds.

### Unit 4 — Known accounts and ingest hardening *(~1 day; scoped down 2026-11-09)*

Jetstream ingest in 2.5A already covers every PDS on the relay, which
was most of this unit. What remains:

- Add an account to the known-account list when it signs in, so backfill
  covers it (its PDS comes from the resolved DID document).
- Verify end to end with an account on a PDS other than `bsky.social`.
- Handle a record whose magnet is dead: the feed entry fails to play.
  Decide whether ingest checks the webseed before indexing.

**Done =** a user signing in from a non-`bsky.social` PDS sees their own
posts in the feed.

### Unit 5 — Retire legacy auth — ✅ ABSORBED into 2.5C.

### Unit 6 — Retire legacy video-post endpoint — ✅ ABSORBED into 2.5C.

### Unit 7 — Web cookie auth *(~half day, gates web release)*

Switch web token storage from `localStorage` to `HttpOnly` /
`SameSite` cookies. Backend exposes a tiny session-cookie endpoint
that wraps the OAuth tokens server-side.

**Done =** the `localStorage` warning above `secureGet` in
`tortok/stores/auth.ts` no longer applies. The web build's XSS surface
for auth tokens is reduced.

## Parallel track (does not block dev work)

**Moderation decision record.** ✅ Resolved 2026-04-29 by Decision 0013. The default
labeler subscription set and opt-out detection for bridged content
remain Beta launch criteria, tracked in [`release-plan.md`](release-plan.md).

## Critical-path order

```
Unit 0 ── Unit 1 ── Unit 2 ── Unit 2.5 ──┬── Unit 3 ──┐
                                         │            ├── Unit 7
                                         └── Unit 4 ──┘
```

Unit 2.5 is the spine of Phase 3: it absorbs Units 5 and 6 and most of
Unit 4. After it lands, Unit 3 (client publishes via PDS) and Unit 4
(known accounts and hardening) can run in either order. Unit 7 (web
cookie auth) is independent of all of the above.

## Explicitly NOT in Phase 3

- Likes and follows (see "Settled before the work started"); they'll
  reuse Bluesky Lexicons.
- Self-custody upgrade flow (deferred decision record).
- `did:web` opt-in (deferred decision record).
- View counts and view ranking (Phase 4, per `view-counting.md`).
- Custom PDS in any form (parked per `open-problems/own-pds.md`).
- Mid-phase scope changes back to a custom PDS. If a trigger from
  `own-pds.md` fires, it becomes a separate decision record and a new
  phase, not a change to Phase 3.

## Open questions

1. ✅ **Test account for Unit 1.** Resolved — `tortok-dev.bsky.social`
   (`did:plc:teqobv6pqer5nw7roqrgi55v`). Reminder: 10 logins/day rate limit.
2. **Blob size sanity.** Still open, deferred to Unit 3. The smoke test
   created a record without a thumbnail blob, so this isn't verified end
   to end. Confirm `bsky.social`'s thumbnail blob limit before Unit 3
   uploads real thumbnails.
3. ✅ **Order of moderation decision record vs Unit 0.** Resolved — Decision 0013 landed
   2026-04-29 ahead of Unit 1.
4. ✅ **Deletion and edits.** Resolved by 2.5A: Jetstream delivers delete
   and update events, and ingest applies them by `at_uri` and `cid`.
5. ✅ **`tortok.app` hosting.** Resolved — Cloudflare Pages serves
   `web/public/`, including the client metadata at
   `/.well-known/oauth-client-metadata.json`.
6. ✅ **Custom dev client.** Resolved — the app is a prebuilt dev client
   (`expo run:*`), which `react-native-mmkv` and WebTorrent need.
