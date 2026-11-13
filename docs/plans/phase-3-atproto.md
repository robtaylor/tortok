# Phase 3 — atproto integration

**Status:** Active — the current phase (Decision 0006 Phase 3).

## Status (2026-11-13)

- ✅ **Unit 0** — Decision 0012 (Lexicon namespace governance) merged; canonical NSID is **`app.tortok.*`** (reverse-DNS rooted at `tortok.app`); schema lives at `lexicons/app/tortok/video/post.json`; AppView+PDS cost note added to Deferred Decisions in [`open-problems/README.md`](../architecture/open-problems/README.md).
- ✅ **Unit 1** — Standalone Node smoke test (`scripts/atproto-smoke-test.mjs`) round-trips an `app.tortok.video.post` record against `bsky.social` using app-password auth.
- ✅ **Unit 2** — OAuth round-trip verified end to end on the iOS simulator (2026-05-02). Android and web haven't been verified. `tortok.app` is live on Cloudflare Pages, `@atproto/oauth-client-expo` is integrated, the Hermes polyfills are in `tortok/lib/polyfills.ts`, the login screen pre-fills the last handle, and the auth store has 7 unit tests.
- ✅ **Unit 2.5** — done 2026-11-13, after a failed first attempt (replanned 2026-05-02, rescoped 2026-11-09). The AppView ingests `app.tortok.video.post` records from Jetstream (2.5A, deployed 2026-11-11) and the feed reads them, with a blob route and runtime sources (2.5B, 2026-11-11). Production runs no legacy auth, write routes or seeder, its legacy tables are dropped, and the app reaches the AppView at `appview.tortok.app`, a setting users can change (2.5C, 2026-11-12). The Bluesky bridge is built, tested, and on in production (2.5D, 2026-11-13), and the final checks passed (2.5E, 2026-11-13). Its sub-phases ran 2.5-0 → 2.5A ingest → 2.5B feed cutover → 2.5C retire legacy → 2.5D Bluesky bridge → 2.5E final checks. It absorbed Units 5 and 6 and most of Unit 4. One question from it is open: when the bridge re-reads an author (the note under 2.5D step 22).
- ➡️ **Unit 3** — next; the client publishes `app.tortok.video.post` via the user's PDS.
- **Unit 4** — not started. Jetstream ingest (2.5A) did most of it; known accounts on sign-in, a check against a PDS other than `bsky.social`, and dead magnets remain.
- ✅ **Units 5 and 6** — absorbed into 2.5C.
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
It was deleted on 2026-11-10: `scripts/seed-fixtures.mjs` (2.5A) does
the same round trip, with the current record shape.

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

### Unit 2.5 — Atproto-native cutover + Bluesky bridge *(~5–7 days; replanned 2026-05-02, rescoped 2026-11-09)* ✅ DONE 2026-11-13

Six months passed between the replan and its execution. The rescoped
version was confirmed on 2026-11-09; the answers to the four
open questions are under [Decisions on the open questions](#decisions-on-the-open-questions-2026-11-09)
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
     Docker image was `node:18-alpine`, which has no global WebSocket. It moved to
     Node 22 on 2026-11-10, so `ws` could now be dropped for the built-in WebSocket.
     Upgrade Node after 2.5C removes the seeder's native dependencies.

3. **Create `scripts/seed-fixtures.mjs`.** It publishes the five BBB clips
   as `app.tortok.video.post` records from `tortok-dev.bsky.social`.
   - It reuses the torrent logic of `seed-prod-test-content.mjs`: same
     infohashes, `content.tortok.net` webseeds, the poster uploaded as
     the thumbnail blob, and the `.torrent` uploaded as `torrentBlob`.
   - It uses app-password auth and caches the session, because the account
     allows 10 logins a day.
   - It's idempotent: records that already exist are skipped.
   - Records in the collection that aren't fixtures are listed, and
     deleted with `--prune`. The 2026-04-30 localhost smoke-test record
     was deleted on the first run.
   - Its clip list and torrent builder are shared with
     `seed-prod-test-content.mjs` (`scripts/lib/test-clips.mjs`), so the
     infohashes always match R2.

4. **Integration tests** for ingest against a real Postgres (Decision
   0016, commitment 2). Tests for the bridged `app.bsky.feed.post` shape
   land with the bridge in 2.5D; 2.5A only checks that ingest ignores it.

**Done =** running `seed-fixtures.mjs` publishes five records; within
seconds the ingest worker has copied them to `posts`, and
`SELECT * FROM posts WHERE collection = 'app.tortok.video.post'`
returns those five rows. Restarting the backend with an empty `posts`
table refills it from backfill.

#### 2.5B — Feed cutover + client fixes (~1 day) ✅ DONE 2026-11-11

Goal: the feed reads `posts`, not `videos`, and the client works after
OAuth login. The legacy write routes still exist but nothing calls
them.

5. ✅ **Modify `backend/src/routes/videos.ts`.** Done: `services/feedView.ts`
   maps `posts` + `profiles` to the feed item; `routes/blob.ts` checks each
   blob against its CID before serving it as immutable.
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

6. ✅ **Runtime sources**, per [Decision 0022](../architecture/decisions/0022-clients-learn-extra-video-sources-from-their-appview.md)
   (the AppView supplies them; the Phase 3 requirement in
   [`cross-deployment-transport.md`](../architecture/open-problems/cross-deployment-transport.md)).
   Each feed item carries a `sources` object beyond its magnet, holding
   extra webseed URLs and extra tracker URLs. The AppView lists its own
   trackers (`TRACKER_URLS`) and, once mirrors exist, webseeds for copies it
   knows of; today `webseeds` is empty.
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
   - ✅ Done early, with the Detox baseline (2026-11-10): the feed query
     no longer depends on the legacy token, and Profile renders the OAuth
     handle and DID with a sign-out button.
   - ✅ The Like button is gone, since Phase 3 ships no likes.
   - ✅ `tortok/lib/api.ts` types follow the new feed shape; the author shows
     as `@handle`, else display name, else DID.
   - ✅ Tests moved with it: the e2e stack publishes the fixtures to its own
     PDS and the backend indexes them; the smoke check reads `playback` and
     `sources` and checks posters.

**Done =** after OAuth login on the iOS simulator, the feed shows the
seeded records and plays them through WebTorrent, and sign-out works
from Profile.

#### 2.5C — Retire the legacy native flow (~1 day) ✅ DONE 2026-11-12

Goal: drop the auth and write surface that's been dead since 2.5B.
Afterwards the only way content reaches the app is through atproto.

8. ✅ **Backend.** Delete `routes/auth.ts`, the JWT bearer path in
   `middleware/auth.ts`, the legacy write routes in `routes/videos.ts`
   (`POST /videos`, `POST /videos/:id/like`, `POST /videos/:id/view`,
   `PATCH /videos/:id/urls`) and `/.well-known/tortok`, which also leaves
   Decision 0016's smoke contract (Decision 0017, item 6).
9. ✅ **Seeder.** Remove `SeederService` (`services/seeder.ts`), the
   `/seeder/stats` route and the `backend/content/tortok-test-video`
   fixture. Update `p2p-torrent.md` and `backend.md` in the same
   change. `fly.toml` stays at `auto_stop_machines = "off"`, not `"stop"`
   as decision 1 below said: ingest runs in this process, and a stopped
   machine misses Jetstream events (decided 2026-11-12). Revisit if ingest
   moves to its own process.
10. ✅ **Schema.** Replace the legacy CREATEs in `schema.sql` with DROPs for
    `users`, `videos`, `hashtags`, `video_hashtags`, `follows`, `likes` and
    `views`. `views` goes too, though this step first kept it (decided
    2026-11-12): its UUID `video_id` referenced `videos`, nothing wrote it,
    and Phase 4 designs view storage afresh.
11. ✅ **Client.** Delete `app/(auth)/register.tsx`; the auth store's `token`,
    `user` and legacy `signIn`; and `lib/api.ts`'s legacy calls and types.
12. **Detox.** ✅ Done early, before 2.5A merged (2026-11-10): the suite
    signs in through an e2e-only app-password form against a throwaway
    PDS, and runs on iOS and Android in CI
    ([Decision 0021](../architecture/decisions/0021-e2e-on-hosted-runners.md)).
    The legacy sign-up and email/password cases are already gone. From now
    on, every client change updates the Detox tests it
    affects, on both platforms, in the same pull request.
13. ✅ **AppView URL setting.** An in-app AppView base-URL setting,
    defaulting to tortok's, replaces the build-time `EXPO_PUBLIC_API_URL`
    (decision 4 below).
14. ✅ **AppView custom domain.** Serve the `tortok-api` Fly app as
    `appview.tortok.app`: a Fly certificate plus a DNS record in the
    Cloudflare `tortok.app` zone, **proxied** through Cloudflare so the
   blob route is cached at the edge. The URL setting's default is that
    domain, so `tortok-api.fly.dev` never ships in a user build. The Fly
    app keeps its name; nothing user-facing shows it. The domain is on
    `tortok.app`, not `tortok.net`, because the AppView is part of the
    app and `tortok.net` is kept for content. It also gives the later
    service DID a stable host (`did:web:appview.tortok.app`). Decided
    on 2026-11-10, along with keeping ingest in the
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
  `scripts/init-dev-secrets.sh`); `CONTENT_ORIGIN_URL` (seeder only);
  `kill_timeout`/`auto_stop_machines = "off"` in `fly.toml` revert to
  scale-to-zero. `TRACKER_URLS` stays: the feed's `sources` list it
  (`backend/src/config.ts`).
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
  `seed-fixtures.mjs` replaces them). The former also uploaded the clips to
  R2, which `seed-fixtures.mjs` doesn't, so that half survives as
  `scripts/upload-test-clips.mjs`. `create-torrent` and `parse-torrent`, which
  `scripts/lib/test-clips.mjs` loaded from `backend/node_modules` through
  `webtorrent`, moved to the root `package.json`, pinned exactly; `scripts/atproto-smoke-test.mjs`
  (superseded by `seed-fixtures.mjs`; already deleted in 2.5A); `scripts/r2-smoke-test.mjs`
  (written for the Phase 0b seeder).
- Docs: `CLAUDE.md` and `open-problems/README.md` used to say the Phase 1
  feed shipped with react-native-video; it never did. Both are fixed;
  re-check nothing else repeats it.
- `test-content/`: the content server's `bbb-0?.magnet.txt` and `.torrent`
  files and its poster and `.torrent` routes, which nothing read, and the
  tracked legacy files `magnet.txt`, `poster.jpg` and `test_video.mp4`. The
  server now seeds `buildClipTorrent`'s output, so one torrent builder is
  left.
- Kept: `test-content/tracker.mjs` (local tracker for dev).
  `scripts/webseed-only-test.mjs` went too: `scripts/smoke.mjs` makes its
  check on every feed item.

**Views.** Removing `POST /videos/:id/view` and the `views` table loses
nothing today, because the client never calls `recordView`. Nothing records views between
2.5C and the `sendInteractions` approach that
[`view-counting.md`](../architecture/open-problems/view-counting.md)
currently leans towards. That gap is accepted: nothing ranks on views
yet, and Decision 0017's off-Fly backup of view data only matters once
views are recorded again, which is Phase 4.

**Done =** `grep -rn 'JWT_SECRET\|bcrypt\|jsonwebtoken' backend/src`
returns nothing. The backend boots without `JWT_SECRET`, and the app
still works end to end against 2.5B's feed.

#### 2.5D — Bring back the bridge (~2 days) ✅ DONE 2026-11-13

Goal: bridged Bluesky video posts appear in the feed as `posts` rows,
keeping Decision 0010 as written: they play from Bluesky's HLS URL over
plain HTTP, with no P2P and no re-hosting (decision 2 below). What the
bridge indexes, and what it drops, is
[Decision 0023](../architecture/decisions/0023-bridged-bluesky-posts-what-the-v1-bridge-indexes.md),
from the
[labels spike](../architecture/decisions/spikes/bluesky-labels-on-bridged-video-posts.md).

15. ✅ **Measure first.** Run a Jetstream subscriber for `app.bsky.feed.post`
    on the production machine (or one sized like it) for an hour and
    record CPU, memory and bandwidth. The spike measured 110,000–190,000
    events and 96–162 MB an hour, of which about 2% are video posts. If
    it doesn't fit beside ingest, stop and size the machine or a separate
    process before building on it.

    **Measured 2026-11-12: it fits.** `scripts/jetstream-load.mjs` ran for
    60 minutes on a throwaway machine in `tortok-api` sized like
    production (`shared-cpu-1x`, 512 MB, `lhr`), parsing every event and
    picking out video posts as the bridge will; the machine was destroyed
    afterwards.

    | Per minute | Median | Max |
    |---|---|---|
    | Events/s | 53 | 92 |
    | CPU, % of one core | 1.8 | 2.6 |
    | RSS, MB | 75.1 | 75.7 |
    | Event-loop lag p99, ms | 10.8 | 10.9 |

    The hour brought 200,754 events and 167 MB, 3,619 video posts (1.8%),
    1,857 of them portrait and 220 self-labelled NSFW, with no
    reconnects. A `shared-cpu-1x` is guaranteed 6.25% of a core and
    bursts above that from a balance that refills while it stays under
    ([Fly: CPU performance](https://fly.io/docs/machines/cpu-performance/)),
    so the stream takes about 30% of that baseline, 42% at its busiest
    minute. Production idles at about 0.1% CPU with 383 of 472 MB
    available, so memory is no constraint either: RSS stayed flat, and
    most of the 75 MB is Node itself, which an in-process bridge shares
    with the backend. Loop lag sat at the monitor's 10 ms resolution,
    so the stream adds none worth measuring. Not measured: the AppView
    `getPosts` lookups (about 145 batched calls an hour at this rate) and
    the database writes, both small beside parsing every event. Run the
    bridge in the backend process; re-measure if Jetstream's rate
    doubles.
16. ✅ **Schema.** A `labels` table (subject URI, labeler DID, value, `neg`,
    label timestamp; keyed by subject, labeler and value) that every
    label source writes to (Decision 0023 item 2). Bridged rows go in
    `posts` with `collection = 'app.bsky.feed.post'`, `video_cid` and
    `hls_url` set and no magnet. The HLS URL is
    `https://video.bsky.app/watch/<percent-encoded did>/<video cid>/playlist.m3u8`.
    Landed with two more `posts` columns, `bridge_checked_at` (the
    poller's queue) and `bridge_qualified_at` (set once a post passes
    every check; the feed serves only those), and `atproto/labels.ts`,
    which turns self-labels and AppView labels into rows and upserts
    them (`replaceSelfLabels` for a record's or profile's self-labels,
    which the author can remove). The NSFW set is `BRIDGE_NSFW_LABELS`.
17. ✅ **`backend/src/services/bskyFirehose.ts`**, ported from attempt 1: a
    Jetstream subscriber for `app.bsky.feed.post` with video embeds
    (alone or in `recordWithMedia`), the aspect-ratio filter, cursor
    persistence, and record self-labels written to `labels`. A post
    whose record carries a label in the configured NSFW set is not
    indexed. Opt-out and NSFW are checked against the author's profile
    too, but their profile labels come with the poller (step 18), so a
    new author's posts stay out of the feed until it has seen them.
    An update event with a new record CID clears `bridge_qualified_at`,
    so an edited post waits for the poller again.
    Landed on its own Jetstream socket and cursor; the socket, backoff,
    ordered queue and cursor are now `services/jetstream.ts`, shared with
    native ingest. Not booted until step 21. A minute against live
    Jetstream indexed 10 posts, each with a working HLS URL.
18. ✅ **`backend/src/services/bskyEngagementPoller.ts`**, ported from attempt
    1: batches of 25 against `app.bsky.feed.getPosts`, writing every post
    and author label to `labels`. It deletes posts that are now labelled
    NSFW, deleted on Bluesky, or by an opted-out author (`!no-unauthenticated`
    on the profile, or `#nobridge` in the bio or display name). It then
    applies the thresholds (50 likes, 10 reposts or 5,000 followers; drop
    after 7 days unqualified), all configurable. It writes the labels
    first and then judges from `labels` for the post and its author, not
    from the response alone, so labels from any other writer count.
    Landed with a decaying schedule (`bridge_next_check_at`: half the
    post's age, 15 minutes to 24 hours, ending for qualified posts at
    `BRIDGE_RECHECK_DAYS`) instead of attempt 1's fixed 30 minutes, which
    at about 1,800 candidates an hour would have been several `getPosts`
    calls a second. Authors go in a new `bridge_authors` table (from
    `getProfiles`, refreshed daily) rather than `profiles`, so the bridge
    can't overwrite a native author's PDS-verified row; its `nobridge`
    records `#nobridge`, and the firehose and poller share one exclusion
    rule (`services/bridgePolicy.ts`). 90 s live: 37 posts indexed, 4
    qualified, 6 dropped, 5 of 34 authors with `!no-unauthenticated`.
19. ✅ **Feed.** Bridged authors come from `bridge_authors`, not `profiles`
    (step 18): the item's author is the `profiles` row if ingest has one
    for the DID, else the `bridge_authors` row, with its CDN avatar URL.
    The feed serves bridged posts only once they've passed the
    poller's checks and thresholds, interleaved with native posts by
    `record_created_at`. Authors with a `contentVisibilityDeclaration`
    asking to be left out of algorithmic feeds are excluded from any
    ranked feed (none yet; the feed is chronological).
    Landed with `playback: { kind: 'hls', url }` and Bluesky's thumbnail as
    the poster, both built from the video CID, and `idx_posts_feed`, a
    partial index of servable rows in feed order, so a page never reads
    the unqualified bridged rows (0.13 ms over 305,000 of them). The smoke
    check checks HLS items too: one failing warns, all failing fails.
20. ✅ **Client.**
    - A new HLS `Playback` kind: the item plays its HLS URL directly
      through `expo-video`, bypassing `useP2PUrl`.
    - A "via Bluesky" badge when the item's AT-URI is an `app.bsky.feed.post`.
    - Tap-through to the post on Bluesky, using the rkey from the AT-URI.
    - Record watch time, completion, loops and skips per post, locally
      (MMKV) and never sent, so future ranking has history
      ([`feed-ranking.md`](../architecture/open-problems/feed-ranking.md)).
    - Detox cases for a bridged item, on both platforms.

    Landed with `usePlaybackUrl`, which switches on the playback kind,
    and the watch history as a bounded log of view events rather than
    per-post totals, since modes and explanations need each view's time.
    The e2e stack's bridged post plays a local HLS fixture
    (`test-content/hls/`, from `make-hls-fixture.sh`), which the content
    server serves in place of Bluesky's video service through a new
    `BRIDGE_VIDEO_BASE` backend setting. `posts.hls_url` is gone: the feed
    builds the URL from the video CID, so it was never read.
21. ✅ **Boot** `bskyFirehose` and `bskyEngagementPoller` from
    `backend/src/index.ts` alongside `atprotoIngest`. One process for v1,
    unless step 15 says otherwise. Landed behind `BRIDGE_ENABLED` (default
    off), which is also the bridge's off switch; production turns it on
    with that one setting.
22. ✅ **Tests.** Integration tests for the NSFW drop at index time and on
    re-label, the opt-out signals (`release-plan.md` makes opt-out
    tested in CI a Beta criterion), thresholds, and Bluesky-side
    deletion, against stubbed Jetstream and `getPosts`.
    Landed as `backend/src/__tests__/bskyBridge.test.ts`. The firehose
    and poller tests already covered each rule on its own service, so
    this one runs them together: commits arrive as Jetstream messages,
    the poller reads a stubbed AppView, and each case checks what
    `GET /videos/feed` serves. Writing it found a gap. The poller
    deleted an excluded author's posts only as each came due, so the
    rest stayed in the feed until their own checks, and for good once
    past the recheck age. It now deletes every bridged post of theirs
    at once (Decision 0023 item 4), and so does the firehose when an
    excluded author posts again.

    **Open: when an author is re-read.** The poller reads an author's
    profile only when one of their posts is due. Three things follow,
    and none is decided:

    - Exclusion is one-way. The firehose indexes nothing by an excluded
      author, so nothing re-reads them, and one who removes `#nobridge`
      or `!no-unauthenticated` stays out. So does one whose
      account-level NSFW label is later withdrawn.
    - An author whose bridged posts are all past the recheck age isn't
      re-read. An opt-out they add then goes unseen, and their posts
      stay in the feed, until they post another video.
    - The recheck age counts from the record's own `createdAt`. A
      backdated post that qualifies on its first check is never
      re-read, so a later label can't reach it.

    Refreshing `bridge_authors` rows on their own schedule would settle
    the first two. Counting the recheck age from when the bridge first
    saw the post would settle the third.

The attempt-1 mirror pipeline doesn't come back: no R2 mirror, no
ffmpeg remux, no `mirror_state` table, no `bridged/` R2 layout and no
backend `/torrents` route.

**Done =** the Jetstream subscriber connects, the filters fire, NSFW and
opted-out posts are dropped, and their labels are in `labels`. The feed
shows native and bridged posts interleaved by `record_created_at`, and
the iOS simulator plays both.

#### 2.5E — Final checks (~half day) ✅ DONE 2026-11-13

18. ✅ **End-to-end run.** Drop the dev database, boot the backend clean, run
    `seed-fixtures.mjs`, let the bridge run for about 10 minutes, and
    scroll the iOS simulator feed through native and bridged rows without
    errors.

    Run 2026-11-13 on `main` at `aee7ae2`. From an empty database the
    backend created its schema and backfilled the five clips. The dev
    account came from `INGEST_SEED_DIDS`, and `seed-fixtures.mjs
    --dry-run` showed all five records up to date, so the script wrote
    nothing. The bridge ran for 11 minutes against live Bluesky, with one
    restart that resumed from the saved cursors. It indexed about 500
    posts, skipped 30 as NSFW and qualified about 50, with no warnings or
    errors and a clean shutdown each time. The smoke check's feed,
    webseed and HLS checks passed against it.

    The iOS simulator then scrolled three bridged posts and the five
    clips, each playing, with no errors logged. It used the e2e build
    already installed, built 2026-11-13 01:24 with the current feed and
    player code. That build crashes when it first adds a torrent if the
    AppView lists a `ws://` tracker, which is the dev default: its bundle
    was built a minute before `npm ci` re-applied the `bittorrent-tracker`
    patch. So the scroll ran with `TRACKER_URLS=wss://tortok-tracker.fly.dev`.
    CI's Detox builds fresh and passes with a `ws://` tracker. A fresh
    local build still needs `npx expo prebuild`.
19. ✅ **Write the area docs.** `auth-signup.md` and `federation.md` are
    written in full after the cutover (the area-doc backfill deferred
    them to here). `federation.md` records that bridged posts live in
    `posts` beside native ones, discriminated by collection NSID.
    Written 2026-11-13, each claim checked against the code.
20. ✅ **The `unit-2.5-attempt-1` tag stays** (decided 2026-11-13). It
    holds the lazy-init OAuth client, which `tortok/lib/atproto/oauth.ts`
    on `main` doesn't have and the web build needs (see
    [auth-signup](../architecture/auth-signup.md#implementation-status)).
21. ✅ **Phase status.** Update the `CLAUDE.md` phases table and this plan's
    status for Units 4–6 absorbed. Done 2026-11-13.

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

#### Decisions on the open questions (2026-11-09)

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

**Housekeeping** (found during 2.5C, none blocking):

- Find out why the Gradle cache's transforms entry changes on every `main`
  run of `e2e.yml`: enable `GRADLE_BUILD_ACTION_CACHE_DEBUG_ENABLED` for two
  runs and diff the file lists. If it holds project-local artifacts from
  `expo prebuild`, excluding `caches/transforms-4` may be cheaper; measure.
  Separately, try Gradle's build cache (`org.gradle.caching=true`) and
  measure it alone.
- Offer the `bittorrent-tracker` fix in `tortok/patches/` upstream. It's a
  pull request to someone else's repository, so it needs a maintainer's
  go-ahead first.
- The Cloudflare token that edits `tortok.app`'s DNS, certificates and cache
  rules has some permissions covering every zone in the account. Narrowing
  them to `tortok.app` is the Cloudflare account owner's decision.

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
