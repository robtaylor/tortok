# Handoff — Backfill the six stub area docs (adoption follow-up 1)

**Created:** 2026-11-04
**Working tree:** clean
**Branch:** main (start a `docs/area-backfill-<area>` branch per area)

## Goal & next-up

**Goal:** replace the six **stub** architecture area docs with full,
present-tense reference docs, each claim verified against the current code — the
first follow-up from the claude-project-discipline adoption (see
[`docs/architecture/README.md`](../architecture/README.md) § Follow-ups).

**Progress:** `backend.md` ✅ done (branch `docs/area-backfill-backend`).

**Next session should pick up:** `client.md`, then
`auth-signup.md`, `federation.md`; do `monetization.md` and `moderation.md` last
(mostly unbuilt — they stay thin, honestly marked). One area per branch/PR;
don't batch all six.

**Verification command:**
```sh
uv run docs/scripts/doctool.py lint
# Expect: 0 error(s), 0 warning(s) — backend.md now links Decision 0006,
# which cleared the old A002. A new area doc must keep its '## Implementation status'
# and '## Decisions behind this' headings (A001) and the decisions it covers
# must stay linked from it (A002).
```

## Side thread agreed 2026-11-08 — write after PR #4 merges (fresh branch from `main`)

Two Proposed docs the user approved; fold this section into them, then delete it.

1. **Decision: the AppView's Postgres is one index among many.** Postgres holds
   only derived, rebuildable data (posts, likes, hashtags, bridged items) plus a
   short, named list of operator-local data (views until `view-counting.md`
   resolves, moderation state, rate limits). Requirements: the client chooses its
   AppView at runtime by service DID (routed via the user's PDS, `atproto-proxy`
   style), not the build-time `EXPO_PUBLIC_API_URL` (`tortok/lib/api.ts:18-30`);
   an AppView self-hosting guide; AppView discovery via declaration records
   (e.g. `app.tortok.appview.declaration`, Decision 0012 namespace), deferred to
   Phase 4+. Retire `/.well-known/tortok` (`backend/src/index.ts:64`, pre-atproto
   "instance" model) and drop it from Decision 0016's smoke contract. Second half:
   hosting (unmanaged Fly Postgres `tortok-db`), backups (verify snapshot
   settings first), migrations (append-only `schema.sql` on boot). Also revises
   Decision 0005's stale "host own PDS / subscribe to own PDS" (superseded in
   practice by the 2026-04-29 amendments and `own-pds.md`).
2. **Open problem: cross-deployment transport** (Must resolve by: Phase 3 for the
   runtime-source requirement). Contents:
   - Tracker and webseed are baked into signed records, so the publisher's origin
     pays forever and old posts die with it; clients should treat magnet sources
     as hints and learn extra sources at runtime (AppView-supplied or
     record-published). Separate trackers split swarms (DHT is off).
   - Candidates: own WebRTC seeders (spike: WebRTC/UDP on Fly), volunteer
     seeders (liability; labeler drop-lists), HTTP mirrors (cheapest; BEP-19
     allows several webseeds).
   - Content domain: `content.tortok.net` (done 2026-11-08). Why `.net` not
     `.app`: a blocklisting of user content must not take down the app, API,
     OAuth or Lexicon domain (the githubusercontent pattern). All three domains
     auto-renew at Gandi; a lapsed content domain breaks every old post.
   - Durability equals R2's; Decision 0010's "P2P-backed durability" pitch
     overstates it. No retention/deletion policy for R2 objects yet.
   - Key real content by infohash (`/v/<infohash>/<file>`) so mirrors copy
     path-for-path.
   - Piece size: create-torrent's default gives 16 KB pieces for ~3 MB clips
     (~180 sequential webseed requests); larger pieces cut requests.
     Changing it changes infohashes.

## Method (applies to every area — do this, not freehand prose)

1. **Model:** copy the depth, present tense, and file-referencing of
   [`docs/architecture/p2p-torrent.md`](../architecture/p2p-torrent.md). Start
   from `_template.md`.
2. **Verify every sentence against code before writing it** (the repo's
   claim-verification rule). A present-tense claim is a claim about today's code
   — read the file, don't infer from the decision record.
3. **Decisions stay frozen.** Move each decision's *current-state* claims into
   the area doc; never edit the decision record's body. Keep the
   `**Current architecture:**` forward-links the decisions already carry.
4. **Keep both required headings** (`## Implementation status`,
   `## Decisions behind this`) and the decision back-links, or lint regresses.
5. **Run `doctool.py lint` before committing**; one area per PR.

## Open follow-ups (priority-ordered)

### 1. ✅ `backend.md` — Backend / AppView (Decision 0005) — done

Read `backend/src/index.ts` (route mounting, seeder init, graceful shutdown),
`routes/auth.ts`, `routes/videos.ts`, `middleware/auth.ts` + `validate.ts`,
`db/schema.sql` + `db/index.ts`, `services/seeder.ts`. Document the live Express
surface (auth, videos, seeder wiring) in present tense; put the AppView
ingest/feed-generation path under Implementation status as **not built yet**
(Phase 3/4). The seeder currently lives here — cross-link
[`p2p-torrent.md`](../architecture/p2p-torrent.md) rather than re-describing it.

### 2. `client.md` — Client / Expo (Decision 0004)

Read `tortok/app/` (Expo Router: `_layout.tsx`, `(auth)/`, `(tabs)/`),
`tortok/stores/`, `tortok/lib/`. Document feed, player, navigation, state, and
the WebTorrent surface it consumes (cross-link p2p-torrent). Note the `Record`
tab is a stub (out of scope per the decisions).

### 3. `auth-signup.md` — Auth & signup (Decision 0007)

atproto OAuth is **client-side**: `tortok/lib/atproto/oauth.ts`,
`tortok/app/(auth)/login.tsx`, `tortok/stores/auth.ts` (+ `auth.test.ts`),
`tortok/assets/oauth-client-metadata.json`. Backend still has the legacy
`routes/auth.ts` + `middleware/auth.ts` (JWT) being retired in Phase 3 — state
which path is live today vs being removed. The OAuth client must be lazy-init'd
(eager construction crashes on `indexedDB is not defined` under Expo Router SSR).

### 4. `federation.md` — Federation / atproto (Decisions 0002, 0003, 0010, 0012)

Read `lexicons/app/tortok/video/post.json` (the only Lexicon so far) and the
Phase 3 plan ([`../plans/phase-3-atproto.md`](../plans/phase-3-atproto.md)) for
what's live vs in-flight. Much of federation (publishing to PDS, the AppView,
the Bluesky bridge) is Phase 3/4 — be honest in Implementation status about what
exists. The bridge mirror-state design is a Phase-3 task (see plan step ~23).

### 5. `monetization.md` — Monetization (Decision 0011)

Grep confirms **no monetization code exists yet** (no payout/pool code in
`backend/src` or `tortok`). Keep this doc thin: the interface-first direction is
set, nothing is built. The open design questions live in
[`open-problems/monetization.md`](../architecture/open-problems/monetization.md)
— link, don't duplicate.

### 6. `moderation.md` — Moderation (Decision 0013)

Grep confirms **no moderation/labeler code exists yet**. Keep thin: strategy is
set (labelers, illegal-content floor, UK age gate), implementation is
launch-blocking and tracked against release criteria
([`../plans/release-plan.md`](../plans/release-plan.md)).

## Critical context

- **The stubs are already lint-clean** (link-only, both headings present). Each
  backfill *replaces* a stub's body — keep the headings and decision links intact
  so D005/A001/A002 don't regress.
- Known client gotchas worth capturing in `client.md`/`auth-signup.md` if still
  true: Hermes WebTorrent polyfills (`self` + `AbortSignal.timeout`), lazy OAuth
  client init, `adb reverse tcp:8080 + tcp:8090` for the Android emulator.

## References

- [`docs/architecture/README.md`](../architecture/README.md) — area map + the Follow-ups section this handoff executes.
- [`docs/architecture/p2p-torrent.md`](../architecture/p2p-torrent.md) — the model area doc.
- [`docs/architecture/_template.md`](../architecture/_template.md) — area-doc template.
- [`docs/architecture/decisions/README.md`](../architecture/decisions/README.md) — decision index (immutable rule).

---

**Resume in a new session with:**
```
/resume_handoff docs/handoffs/area-doc-backfill-handoff.md
```
