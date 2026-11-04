# Phase 3 — atproto integration

**Status:** Active — the current phase (Decision 0006 Phase 3).

## Previous plan (parked)

The previous content of this plan file scoped **Unit 5 — Client seeding
policy (Decision 0009)** for Phase 2. That work is now parked: the user and I
agreed to defer the client seeding policy until post-Phase 3, once we
know how PDS-driven session lifetimes interact with foreground-only
seeding. The previous plan has been backed up at
`squishy-stargazing-hopcroft.backup-20260429-0100.md`. The
`tortok/lib/webtorrent/seedPolicy.ts` and `useSeedPolicy.ts` stubs
referenced there were never implemented; nothing to clean up.

## Status (2026-05-02 evening — Unit 2.5 replanned)

- ✅ **Unit 0** — Decision 0012 (Lexicon namespace governance) merged; canonical NSID is **`app.tortok.*`** (reverse-DNS rooted at `tortok.app`); schema lives at `lexicons/app/tortok/video/post.json`; AppView+PDS cost note added to Deferred Decisions in [`open-problems/README.md`](../architecture/open-problems/README.md).
- ✅ **Unit 1** — Standalone Node smoke test (`scripts/atproto-smoke-test.mjs`) round-trips an `app.tortok.video.post` record against `bsky.social` using app-password auth.
- ✅ **Unit 2** — End-to-end OAuth round-trip verified on iOS sim. `tortok.app` Cloudflare Pages live. `@atproto/oauth-client-expo` integrated. Hermes polyfills (`AbortSignal.timeout`, `AbortSignal.prototype.throwIfAborted`) at `tortok/lib/polyfills.ts`. Last-handle pre-fill + iOS autofill hints. 7 auth-store tests.
- 🔁 **Unit 2.5 — REPLANNED 2026-05-02 evening.** First attempt (4 slices, 13 fixes, ~30 commits) preserved on `unit-2.5-attempt-1` tag. `main` reset to `670061a` (pre-Unit-2.5). Architectural takeaways from the attempt: (1) `bridged_posts` as a separate table was a defensive kludge; the right model is one `posts` table holding atproto records of either lexicon, with mirror state in a sidecar. (2) The `source` discriminator column was redundant — at-uri's collection segment carries the same info. (3) Most issues were bridged-content-specific data-shape problems; the bridge.native.ts + WebTorrent-on-Hermes infrastructure itself is healthy (Phase 2 measured 89–91% P2P offload between two sims; native at this commit cold-starts in ~413ms). The byte-level fixes from the attempt (HLS→MP4 ffmpeg remux with `-movflags +faststart`, 16K piece size, query-string strip from playlist, NSFW self-label filter, listener leak fixes, lazy-init OAuth client, per-request bridge logging) carry forward — only the table architecture and integration shape get rewritten.
- ➡️ **Unit 2.5 (v2)** — see "Replanned Unit 2.5" below. Phase 0 cleanup → Phase A atproto-native ingestion → Phase B feed cutover → Phase C retire legacy → Phase D bring back bridge → Phase E final cleanup. Absorbs Unit 4 (partial), Unit 5, Unit 6 from the original plan.
- **Unit 3** — after Unit 2.5 (v2); client publishes `app.tortok.video.post` via the user's PDS.
- **Unit 7** — web cookie auth (still pending; unchanged).
- ✅ **Moderation parallel track** — Decision 0013 landed 2026-04-29 (atproto labelers + illegal-content floor + UK age-verification gate); `open-problems/moderation.md` deleted.

**The meta-lesson from attempt 1.** Coding was the easy bit — the day was 80% problem identification, 20% code. Each new bug-fix layer revealed the next misalignment with end-state architecture. The replan absorbs end-state into Unit 2.5 directly so we stop building toward a target we'd have to demolish in Unit 4 anyway.

Plan amendment 2026-05-01: every `tortok.*` lexicon reference in the
units below should be read as `app.tortok.*`; the schema example in
Unit 0 has been replaced with a pointer to the live file rather than
duplicating it.

## Context

Phase 2 (cross-platform P2P) signed off 2026-04-29 with a two-iOS-sim
test measuring 89–91% P2P offload between two peers. Phase 3 is now
the active phase.

The original Phase 3 scope ("fork our own atproto PDS, custodial
signup, migrate users") was reversed in the same session — see the
2026-04-29 amendments to Decision 0003 and Decision 0007, plus
`docs/architecture/open-problems/own-pds.md`. The current Phase 3
leverages users' existing atproto identities (typically `bsky.social`)
and is materially smaller.

## Going-in answers (decisions reached in 2026-04-29 conversation)

These are not decision records yet — they're working decisions that should harden
into decision records as we hit them.

1. **Relay vs poll for AppView ingest.** Poll a known list of PDS
   hosts for v0 (probably just `bsky.social`). Switch to relay
   subscription in Phase 4 once we know what the firehose-scaling
   problem actually looks like. Cheap, avoids premature scaling work.
2. **Reuse Bluesky's lexicons for social graph.** When Phase 3 (or a
   later phase) adds follows/likes, use `app.bsky.graph.follow` and
   `app.bsky.feed.like` rather than defining `app.tortok.graph.*`. Pros:
   cross-pollination with Bluesky's existing graph, no new schema work,
   the social graph isn't tied to content type. Cons: coupling to
   Bluesky's namespace governance. Lexicon stability is a stated
   Bluesky value; risk is small. Likes use a generic `strongRef`
   subject so they can point to `app.tortok.video.post` records natively.
3. **Skip likes/follows for Phase 3 entirely.** Phase 3 ships read-only
   from a curated feed. Social graph comes in a later phase, with the
   "reuse Bluesky lexicons" decision (#2) already made.
4. **Postgres pivots, doesn't retire.** Drops `users` (replaced by
   atproto identity), repurposes `videos` as a read-side index of
   `app.tortok.video.post` records authored on user PDSes, keeps `views`
   (we own view counts; not federated), keeps `hashtags` index
   (re-populated by ingest worker). Federation isn't broken because
   the records live on PDSes, not in our postgres — anyone can rebuild
   the index from the same PDS records.

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

### Unit 2 — Client OAuth login *(~2–3 days; revised 2026-05-01)* ✅ DONE 2026-05-02

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
   - DNS + static hosting decision is open; Cloudflare Pages is the
     obvious fit given we already use Cloudflare for R2 (Decision 0008), but
     not committed.
   - Web build's redirect URI also needs to live on `tortok.app`
     (e.g. `https://tortok.app/auth/callback`), so this hosting needs
     a small `auth/callback` route or a static page that calls
     `oauth.handleCallback()`.
   - **Tracking:** add this as an open problem if it slips —
     `tortok.app` hosting blocks Phase 3 launch.
2. **Confirm the Expo client is already prebuilt** (custom dev
   client, not Expo Go). MMKV requires it. Phase 2's WebTorrent work
   should already have forced this; verify before installing.
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
    fields in Unit 5.
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
  cut over to OAuth in their RN client. We'll be on a short list of
  public Expo apps doing this.
- **Single-use refresh tokens** mean concurrent XRPC calls from two
  stale `Agent` instances over the same session can race. The core
  has locking; just don't construct multiple agents for one session.
- **Rate limit during dev.** `tortok-dev.bsky.social` is 10
  logins/day/account. OAuth flows count against this. Cache sessions
  aggressively in dev.
- **`tortok.app` hosting decision pending** — see prereq 1.

**Done =** "Sign in with Bluesky" works on iOS simulator, Android
emulator, and web. Logged-in DID visible in app state. Cold start
restores the session via `oauth.restore(did)`. Logout revokes.

### Unit 2.5 (v2) — Atproto-native cutover + Bluesky bridge *(~5–7 days; replanned 2026-05-02 evening)*

**Why a replan.** First attempt (preserved on `unit-2.5-attempt-1`
tag, ~30 commits) shipped `bridged_posts` as a sidecar table with
a `source: 'tortok' | 'bsky'` discriminator on the feed. Each
debugging round revealed the same misalignment: we were building
toward an architecture (legacy native flow + bridged sidecar) that
Unit 4 + Unit 5 + Unit 6 were going to demolish anyway. Bisecting
to `670061a` (pre-Unit-2.5) confirmed that the bridge.native.ts +
WebTorrent-on-Hermes infrastructure is fine — the slow plays and
R2 429s were data-shape problems, not platform problems.

**End-state architecture this replan commits to.**

- One `posts` table holding atproto records of either lexicon
  (`app.tortok.video.post` or `app.bsky.feed.post` with a video
  embed). At-uri's collection segment carries the lexicon discriminator
  — no `source` column needed.
- One `mirror_state` sidecar table keyed by `at_uri`, written
  only by the bridge. The feed query does not care that it
  exists; only the bridge orchestration code reads/writes it.
- Federation-equal rendering: a row is a row. Client treats
  `app.tortok.*` and `app.bsky.*` posts identically except for
  the canonical-link target (tortok.app vs bsky.app) and an
  optional "via Bluesky" badge.
- Legacy native auth + native write paths retire as part of this
  unit (absorbed Unit 5 + Unit 6).

**This unit absorbs.** Original Unit 4 (partial — atproto-native
ingest), Unit 5 (retire legacy auth), Unit 6 (retire legacy
video-post endpoint). It does NOT absorb Unit 4's full firehose
subscriber for `app.tortok.*` records on PDSes other than
`bsky.social` — that stays in Unit 4 (now scoped down).

#### Phase 0 — Cleanup (before starting; ~1h)

Reset already done. This phase removes the database + R2 detritus
left by attempt 1 so Phase A starts clean.

1. **Drop the attempt-1 tables** by appending to
   `backend/src/db/schema.sql` (the project keeps schema as a single
   append-only idempotent SQL file, run via `initializeDatabase()` on
   backend boot — there is no `migrations/` directory):
   ```sql
   DROP TABLE IF EXISTS bridged_posts;
   DROP TABLE IF EXISTS bridge_cursor;
   ```
   Even though main is reset, dev DBs still carry the tables; the
   next `npm run dev` will drop them. The DROPs stay in the file
   permanently — idempotent, and the table names will not be reused.

2. **R2 cleanup** — list and delete `bridged/` prefix in the R2
   content bucket. ~2,669 mirrored objects from the NSFW cleanup
   pass plus whatever else accumulated. Use `wrangler r2 object
   delete` or the existing `scripts/r2-*.mjs` helpers; whichever
   is faster.

3. **Stop attempt-1 background services.** Local dev process
   (`backend` ts-node-dev) auto-reloads off `670061a`, but if
   any leftover `bskyFirehose` / `bskyEngagementPoller` /
   `bskyMirror` processes survived, kill them. Confirm by
   greping `ps` for `tsx` / `node` against the backend dir.

4. **Smoke check.** `npm run dev` (backend) + iOS sim → feed
   loads native videos at sub-second cold-start (matches the
   bisect baseline of ~413ms).

**Done =** dev DB has no `bridged_*` tables. R2 `bridged/` prefix
empty. Backend boots without bridge services. Native feed plays
fast.

#### Phase A — Atproto-native ingestion (~1.5–2 days)

Goal: tortok-native posts (created via Unit 3 or seed-fixtures)
flow into a unified `posts` table that the feed reads from.
Native legacy `videos` table still exists at end of this phase
(Phase C drops it) — Phase A operates in parallel.

5. **APPEND to `backend/src/db/schema.sql`** — the unified posts table:
   ```sql
   CREATE TABLE IF NOT EXISTS posts (
     at_uri TEXT PRIMARY KEY,            -- at://did/collection/rkey
     did TEXT NOT NULL,
     collection TEXT NOT NULL,           -- 'app.tortok.video.post' | 'app.bsky.feed.post'
     rkey TEXT NOT NULL,
     cid TEXT NOT NULL,                  -- record CID (for revision tracking)
     -- Author profile snapshot (denormalized for feed reads)
     handle TEXT,
     display_name TEXT,
     avatar_url TEXT,
     -- Content
     text TEXT,
     video_cid TEXT,                     -- the video blob's CID, used for canonical playback URL
     poster_url TEXT,
     duration_ms INTEGER,
     width INTEGER,
     height INTEGER,
     aspect_ratio_w INTEGER,
     aspect_ratio_h INTEGER,
     -- Playback (populated by mirror for bsky-collection rows; native for tortok rows)
     magnet_link TEXT,
     torrent_file_url TEXT,
     hls_url TEXT,                       -- only set for `app.tortok.*` rows; `app.bsky.*` plays from torrent
     -- Lifecycle
     record_created_at TIMESTAMPTZ NOT NULL,
     indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS idx_posts_collection_created
     ON posts (collection, record_created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_posts_did ON posts (did);
   ```
   No `source` column — `collection` is the discriminator (and
   it's already part of the `at_uri`, so the column is just a
   denormalized index helper).

6. **CREATE `backend/src/services/atprotoIngest.ts`** — pull
   worker for `app.tortok.video.post` records.
   - For each known PDS (just `bsky.social` for v1), poll
     `com.atproto.repo.listRecords?repo=<did>&collection=app.tortok.video.post`
     for known DIDs (start with the test account
     `tortok-dev.bsky.social`). UPSERT into `posts` keyed by
     `at_uri`.
   - Cadence: 30s (matches original Unit 4 thinking).
   - `cid` revision check: if the existing row's `cid` differs
     from the fetched record's `cid`, replace; else no-op.
   - For deletes (record disappears from listRecords), DELETE by
     `at_uri`. Tombstone-vs-actual-delete is a Phase 4 concern;
     v1 just drops.
   - Boot from `backend/src/index.ts` alongside the seeder.

7. **CREATE `scripts/seed-fixtures.mjs`** — populates atproto with
   the existing test fixtures (the big-buck-bunny clip etc.
   already committed).
   - Uses app-password auth against `tortok-dev.bsky.social` (per
     `bsky-test-account.md` memory; remembers 10 logins/day rate
     limit, so cache the session).
   - Reads fixture metadata from wherever the legacy seeder
     stages it (likely `backend/src/services/seeder.ts` test
     paths).
   - Uploads thumbnail blob → creates `app.tortok.video.post`
     records with the magnet link, hls url, poster, etc.
   - Idempotent: skip records that already exist (lookup by rkey
     pattern).

**Done =** running `seed-fixtures.mjs` populates the test PDS
with N records; within 30s the ingest worker has copied them to
`posts`; `SELECT * FROM posts WHERE collection = 'app.tortok.video.post'`
returns those N rows.

#### Phase B — Cutover feed + client (~half day)

Goal: feed reads from `posts`, not `videos`. Client unchanged.
Legacy `POST /videos` etc. still exist but no one uses them.

8. **MODIFY `backend/src/routes/videos.ts`**:
   - `GET /feed` reads from `posts ORDER BY record_created_at DESC LIMIT N`.
   - Mapping: `at_uri → id`, `did/handle/display_name/avatar_url
     → user.*`, `magnet_link/torrent_file_url/hls_url → playback`.
   - `GET /videos/:id` likewise reads from `posts`.
   - Legacy write routes (`POST /videos`, `POST /likes`, `PATCH
     /videos/:id/urls`, etc.) still exist — left alone in this
     phase, dropped in Phase C.

9. **MODIFY `tortok/lib/api.ts`** — types should already align
   if the API response shape matches; only swap the field name
   if anything was renamed. (Expect zero or near-zero client
   changes.)

**Done =** iOS sim feed shows the seeded fixture videos, playing
through the existing WebTorrent client at native speed. Cold
start latency stays near the 413ms bisect baseline.

#### Phase C — Retire legacy native flow (~half day)

Goal: drop the auth + write surface that's been dead since
Phase B's feed-cutover. After this phase, the only way content
reaches the app is via atproto.

10. **DELETE `backend/src/routes/auth.ts`**, the
    `backend/src/middleware/auth.ts` file's password-bearer path,
    `users` table migration, password-reset flow, JWT secret
    handling. (OAuth tokens already work end-to-end per Unit 2.)
11. **DELETE legacy write routes** in `backend/src/routes/videos.ts`:
    `POST /videos`, `POST /videos/:id/like`, `POST /videos/:id/view`,
    `PATCH /videos/:id/urls`. Likewise the corresponding service
    code.
12. **DROP legacy tables** by appending to `schema.sql`: `users`,
    `videos`, `hashtags`, `video_hashtags`, `follows`, `likes`. Keep `views`
    (we own view counts; not federated; will be repurposed in
    Phase 4).
13. **MODIFY `tortok/stores/auth.ts:18`** — drop the email/password
    token bucket TODO. (Confirm no callers remain.)
14. **MODIFY `backend/src/index.ts`** — drop boot of any retired
    services. `JWT_SECRET` no longer required; remove from
    `.env.example`.

**Done =** `grep -r 'JWT_SECRET\|password\|users.*table' backend/`
returns nothing meaningful. Backend boots without
`JWT_SECRET`. App still works end-to-end against Phase B's feed.

#### Phase D — Bring back the bridge (~2 days)

Goal: cherry-pick the byte-level fixes that actually worked from
attempt 1 (preserved on `unit-2.5-attempt-1` tag), wired into the
unified `posts` table architecture rather than a sidecar.

15. **CREATE `backend/src/services/bskyFirehose.ts`** — same as
    attempt 1 (Jetstream subscriber, NSFW self-label filter,
    aspect ratio filter, cursor persistence). Difference:
    - On match, INSERT into a NEW table `mirror_state` keyed by
      `at_uri`, with `state = 'pending'`. Does NOT touch `posts`
      yet.

16. **APPEND to `backend/src/db/schema.sql`**:
    ```sql
    CREATE TABLE IF NOT EXISTS mirror_state (
      at_uri TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      cid TEXT NOT NULL,                -- record CID
      video_cid TEXT NOT NULL,          -- video blob CID (mirror source URL)
      bsky_playlist_url TEXT NOT NULL,
      -- Engagement (poller writes)
      like_count INTEGER,
      repost_count INTEGER,
      reply_count INTEGER,
      author_followers_count INTEGER,
      engagement_polled_at TIMESTAMPTZ,
      -- State machine
      state TEXT NOT NULL DEFAULT 'pending',  -- pending|mirrored|declined|expired
      mirrored_at TIMESTAMPTZ,
      r2_path TEXT,
      magnet_link TEXT,
      torrent_file_url TEXT,
      last_played_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS bridge_cursor (
      key TEXT PRIMARY KEY,
      cursor TEXT,
      updated_at TIMESTAMPTZ
    );
    ```
    Sidecar by design — only the bridge code reads/writes this.
    Feed query does not touch it.

17. **CREATE `backend/src/services/bskyEngagementPoller.ts`** —
    same as attempt 1 (batches of 25 against
    `app.bsky.feed.getPosts`, promotion thresholds, NSFW labeler
    aggregation per Bluesky's default labeler set).

18. **CREATE `backend/src/services/bskyMirror.ts`** — port from
    attempt 1, keeping the byte-level fixes:
    - HLS → MP4 ffmpeg remux (`-c copy -bsf:a aac_adtstoasc
      -movflags +faststart`).
    - Strip query strings from the playlist before passing to
      ffmpeg (HLS demuxer rejects query-string segments).
    - 16KB piece size for first-piece latency.
    - R2 layout: `bridged/<did>/<cid>.mp4` + `.torrent` next to it.
    - On success, transition `mirror_state` to `mirrored`, AND
      INSERT into `posts` with `collection = 'app.bsky.feed.post'`,
      `magnet_link`/`torrent_file_url` populated, `hls_url = NULL`.
      (Single playback path: torrent + webseed against R2 MP4.)
    - On NSFW label retro-flagging or storage decay, transition
      to `expired` AND DELETE the `posts` row.

19. **CREATE `backend/src/routes/torrents.ts`** — serve `.torrent`
    files from the backend, NOT from `pub-*.r2.dev`. Fixes the R2
    429 rate-limit issue from attempt 1 (R2 public hostname has
    aggressive rate limits; the backend can cache + serve at
    line speed).
    - `GET /torrents/<did>/<cid>.torrent` → fetch from R2 once,
      cache in-memory or on disk, serve with long Cache-Control.
    - `mirror_state.torrent_file_url` writes the backend route,
      not the R2 hostname.

20. **MODIFY `tortok/app/(tabs)/index.tsx`** — minor display
    additions:
    - "via Bluesky" badge when `at_uri` starts with
      `at://*/app.bsky.feed.post/*`.
    - Tap-to-Bluesky link (parse `<rkey>` from at-uri).
    - Player setup unchanged (single playback path: magnet +
      webseed for both collections).

21. **MODIFY `backend/src/index.ts`** — boot
    `bskyFirehose` + `bskyEngagementPoller` + `bskyMirror`
    alongside `atprotoIngest` and the seeder. Single process for
    v1; Phase 0b extracts per Decision 0010-A operational note.

**Done =** Jetstream subscriber connects, filters fire, NSFW
gets demoted. Promoted posts get mirrored to R2 as MP4, written
into `posts` with `app.bsky.feed.post` collection. Feed shows
mixed native + bridged content interleaved by `record_created_at`.
iOS sim plays bridged MP4s through the same P2P+webseed path as
native. No R2 429s on `.torrent` fetches (served by backend).

#### Phase E — Test + final cleanup (~half day)

22. **End-to-end test.** Stop all services, drop dev DB, run
    migrations clean, restart backend, run `seed-fixtures.mjs`,
    let firehose run for ~10 min, confirm both native + bridged
    rows in feed, scroll the iOS sim feed without errors.
23. **Record the mirror-state architecture.** Its present-tense
    current state ("Mirror state lives in a sidecar `mirror_state`
    table; bridged posts coexist with native posts in `posts`
    discriminated by collection NSID. No `source` column.") belongs
    in the federation area doc (`docs/architecture/federation.md`).
    If it changes the choice Decision 0010 made, write a *superseding*
    decision record rather than editing 0010 — decisions are
    immutable.
24. **Delete `unit-2.5-attempt-1` tag** (or keep as historical
    reference — user's call). The byte-level fix lessons are
    captured in this plan + ported code; the tag can stay if it
    feels safer.
25. **Update CLAUDE.md phase status** for Phase 3 to reflect
    Units 4–6 absorbed.

**Done =** Phase 3 progresses to Unit 3 (client publishes via
PDS) with Phase 3's atproto-native data layer, retired legacy
flow, and working bridge in place.

#### What carries forward from attempt 1

Concrete fixes ported into Phase D, all preserved on the
`unit-2.5-attempt-1` tag:

- HLS → MP4 ffmpeg pipeline (`-c copy -bsf:a aac_adtstoasc
  -movflags +faststart`).
- Strip query-strings from playlist segments before ffmpeg.
- 16KB piece size for low first-piece latency.
- NSFW self-label filter (`porn|sexual|nudity|graphic-media|gore`)
  + Bluesky default labeler aggregation.
- WebTorrent listener leak fix (use `.once()` for done event,
  capture/remove error listener; `setMaxListeners(50)`).
- Lazy-init OAuth client (survives Expo Router SSR pass).
- Hermes polyfills (`AbortSignal.timeout`,
  `AbortSignal.prototype.throwIfAborted`).
- Per-segment URL encoding in `bridge.native.ts` (commit 608222b).
- Per-request bridge logging (commit 25a2ef7).

#### What does NOT carry forward

- The `bridged_posts` table architecture.
- The `source: 'tortok' | 'bsky'` discriminator column.
- The `videos` ⊕ `bridged_posts` UNION in the feed query.
- The `pub-*.r2.dev` direct-fetch path for `.torrent` files
  (replaced by backend route).

#### Risks

- **Phase B cutover cliff.** Feed switches from `videos` to
  `posts` in one go. Mitigation: Phase A populates `posts` from
  fixtures BEFORE Phase B flips the read path; if Phase A goes
  wrong, the cutover doesn't happen.
- **R2 rate-limit on public hostname.** Now mitigated by
  backend-served `.torrent` route. Verify in dev that backend
  serves `.torrent` correctly under load (~25 cold-starts in a
  scroll session).
- **Schema migration on dev DB.** Phase C drops 6 tables. If
  there's accidental dev data we want, capture it before. Likely
  zero — dev DB is regenerable.
- **Test PDS rate limits.** `tortok-dev.bsky.social` is 10
  logins/day. `seed-fixtures.mjs` uses one app-password session;
  cache it. Engagement poller hits public AppView (no auth, but
  rate-limited too — same backoff as attempt 1).
- **Mirror-state vs posts consistency.** Two writes (mirror
  pipeline writes both). If one fails, recovery requires
  reconciliation. v1 accepts: on bskyMirror restart, scan
  `mirror_state WHERE state = 'mirrored' AND at_uri NOT IN (SELECT
  at_uri FROM posts)` and re-insert the missing posts row.

### Unit 3 — Client publishes via PDS *(~1–2 days)*

- Video upload flow: generate magnet (already done) → upload thumbnail
  blob via user's PDS → create `app.tortok.video.post` record.
- The legacy `POST /videos` route is gone after Unit 2.5 (v2)
  Phase C; the client only writes via PDS.
- Hashtags travel inside the record (already in the lexicon shape).
- Once the record lands in the user's PDS, Unit 2.5 (v2) Phase A's
  `atprotoIngest` worker picks it up within 30s and inserts into
  `posts`. The feed shows it.

**Done =** posting from the app produces a record in the user's PDS
repo. Verified via `atproto-inspector` or Bluesky's web UI; same
record then appears in the feed within ~30s.

### Unit 4 — AppView ingest at scale *(~2–3 days; scoped down 2026-05-02)*

Originally "the biggest unit" — the atproto ingestion piece is now
delivered by Unit 2.5 (v2) Phase A for `bsky.social`. Unit 4 only
remains for **multi-PDS scale**:

- Generalize `atprotoIngest` from "poll one known PDS" to "poll
  N known PDSes" (still polling, not firehose).
- Discover PDS hosts as users sign in — pull `pds` from the
  resolved DID document, add to the polled set.
- Handle deletes (record disappears from listRecords) cleanly;
  drop the corresponding `posts` row. (Phase A v1 already does
  this; Unit 4 just hardens it.)
- Optional: replace polling with relay subscription if poll
  cadence proves a bottleneck. Punt to Phase 4 if not needed.

**Risk.** Same as before: a `app.tortok.video.post` record that
references a dead magnet produces a dead feed entry. Out-of-band
ingest path may need to tickle L1 origin (Decision 0008). Folds into
this unit.

**Done =** a user signing in from a non-`bsky.social` PDS sees
their own posts in the feed.

### Unit 5 — Retire legacy auth — ✅ ABSORBED into Unit 2.5 (v2) Phase C.

### Unit 6 — Retire legacy video-post endpoint — ✅ ABSORBED into Unit 2.5 (v2) Phase C.

### Unit 7 — Web cookie auth *(~half day, gates web release)*

Switch web token storage from `localStorage` to `HttpOnly` /
`SameSite` cookies. Backend exposes a tiny session-cookie endpoint
that wraps the OAuth tokens server-side.

**Done =** `tortok/stores/auth.ts:18` TODO closed. Web build's XSS
surface for auth tokens reduced.

## Parallel track (does not block dev work)

**Moderation decision record.** ✅ Resolved 2026-04-29 by Decision 0013. Default
labeler subscription set + opt-out detection for bridged content
remain Phase A launch criteria, tracked in `release-plan.md`.

## Critical-path order

```
Unit 0 ── Unit 1 ── Unit 2 ── Unit 2.5 (v2) ──┬── Unit 3 ──┐
                                              │            ├── Unit 7
                                              └── Unit 4 ───┘
```

Unit 2.5 (v2) is the spine of Phase 3: it absorbs Units 5 + 6
(retire legacy auth + retire legacy video-post endpoint) and the
single-PDS slice of Unit 4 (atproto-native ingestion from
`bsky.social`). After it lands, Unit 3 (client publishes via PDS)
and Unit 4 (multi-PDS ingest at scale) can run in either order.
Unit 7 (web cookie auth) is independent of all of the above.

## Explicitly NOT in Phase 3

- Likes / follows (deferred per going-in answer #3, will reuse
  Bluesky lexicons).
- Self-custody upgrade flow (deferred decision record).
- `did:web` opt-in (deferred decision record).
- Decision 0009 client seeding policy (parked, post-Phase 3).
- AppView firehose subscriber at full Bluesky scale (Phase 4).
- View counts / view ranking (Phase 4 per `view-counting.md`).
- Custom PDS in any form (parked per `open-problems/own-pds.md`).
- Mid-phase scope changes back to a custom PDS — if a trigger from
  `own-pds.md` fires, it becomes a separate decision record + new phase, not a
  Phase 3 amendment.

## Open questions before kicking off

1. ✅ **Test account for Unit 1.** Resolved — `tortok-dev.bsky.social`
   (`did:plc:teqobv6pqer5nw7roqrgi55v`). Credentials in memory at
   `memory/bsky-test-account.md`. Reminder: 10 logins/day rate limit.
2. **Blob size sanity.** Still open — deferred to Unit 3 (the smoke
   test created a record without a thumbnail blob, so this isn't yet
   verified end-to-end). Confirm `bsky.social`'s thumbnail blob limit
   before Unit 3 starts uploading real thumbnails.
3. ✅ **Order of moderation decision record vs Unit 0.** Resolved — Decision 0013 landed
   2026-04-29 ahead of Unit 1.
4. **Deletion / mutation story.** Still open — what happens when a
   user deletes an `app.tortok.video.post` record from their PDS?
   Our AppView needs to notice and remove the indexed copy. Same for
   edits. Folds into Unit 4.
5. **`tortok.app` hosting** *(new, 2026-05-01)*. Where does the
   `oauth-client-metadata.json` file live, and where does the web
   build's `auth/callback` route live? Cloudflare Pages is the
   obvious fit (we already use Cloudflare for R2 per Decision 0008) but
   not yet committed. Blocks Unit 2 from talking to a real PDS;
   doesn't block writing the client code locally against a
   loopback `client_id`.
6. **Custom dev client status.** Sanity-check that `tortok/` is
   already prebuilt with EAS — required for `react-native-mmkv` (and
   for WebTorrent from Phase 2). One-line check before installing.
