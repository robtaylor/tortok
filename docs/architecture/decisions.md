# TorTok Architecture Decisions — Index

This is the index for TorTok's architectural decisions. Each decision is its
own ADR file at [`adr/NNNN-slug.md`](./adr/). The index also collects the
unresolved problems, execution risks, deferred decisions, and Appendix A
(historical Phase 0 punch list).

ADRs follow a lightweight format: Status, Context, Decision, Consequences,
Alternatives. If a decision turns out to be wrong, **add a new ADR** with
`Supersedes: ADR-NNN` rather than editing the old one. Amendments to a live
ADR are explicit and dated within that ADR's body.

Unresolved design questions live in [`open-problems/`](./open-problems/), each
with a `Must resolve by:` header stating the phase that forces the decision.

## ADRs

| # | Title | Status |
|---|---|---|
| [ADR-001](./adr/0001-webtorrent-end-to-end.md) | Torrent engine is WebTorrent, end to end | Accepted |
| [ADR-002](./adr/0002-atproto-federation.md) | Federation protocol is AT Protocol | Accepted (amended 2026-04-29 — NSID `app.tortok.video.post`) |
| [ADR-003](./adr/0003-identity-dids.md) | Identity uses DIDs — `did:plc` default, `did:web` opt-in | Accepted (amended 2026-04-29 — no custodial PDS) |
| [ADR-004](./adr/0004-client-expo-react-native.md) | Client is Expo + React Native + TypeScript | Accepted |
| [ADR-005](./adr/0005-backend-node-appview.md) | Backend stays Node + TypeScript; evolves into an AppView | Accepted |
| [ADR-006](./adr/0006-migration-from-swift.md) | Migration path from the Swift prototype | Accepted (Phases 0a/0b/1/2/5 complete; Phase 3 in flight) |
| [ADR-007](./adr/0007-signup-and-spam-prevention.md) | Signup UX and spam prevention | Accepted (amended 2026-04-29 — atproto-OAuth, no custodial signup) |
| [ADR-008](./adr/0008-seeder-storage-cdn.md) | Seeder, storage, and CDN infrastructure | Accepted |
| [ADR-009](./adr/0009-client-seeding-policy.md) | Phase 2 client seeding scope and policy | Accepted |
| [ADR-010](./adr/0010-bluesky-video-bridge.md) | Bridge Bluesky video posts into the tortok feed (inbound federation) | Accepted (amended 2026-05-02 — Path 2 mirroring) |
| [ADR-011](./adr/0011-monetization-architecture.md) | Monetization architecture — interface-first payout, first-party pool committed | Accepted (V1 rail gated on Apple guidance + US-incorporation) |
| [ADR-012](./adr/0012-lexicon-namespace.md) | Lexicon namespace governance | Accepted |
| [ADR-013](./adr/0013-moderation-strategy.md) | Moderation strategy — atproto labelers, illegal-content floor, UK age-verification gate | Accepted |

---

## Unresolved design problems

Real design problems with candidate approaches live in
`docs/architecture/open-problems/`. Each file has a `Must resolve by:`
header stating the phase that forces the decision.

- **`view-counting.md`** — resolve by Phase 4 AppView cutover, or
  earlier if feed ranking uses view counts. Under the external
  monetization model (see `monetization.md`) this becomes the single
  most important signal TorTok provides to creators.
- **`seeding-policy.md`** — server side resolved in Phase 0b
  (demand-pull only), client side resolved in ADR-009 (scroll-back
  window on mobile, battery-gated aggressive on desktop/web). File
  is kept as context for the starting numbers; Phase 2 validates
  them and any policy change supersedes ADR-009.
- **`monetization.md`** — philosophy decided; architecture
  direction set in ADR-011 (interface-first, first-party pool
  committed, Stripe+USDC-on-Base leading V1 rail candidate). Two
  prerequisites remain open before V1 rail commitment: Apple App
  Store Guideline 3.1.1 written position, and the tortok
  US-incorporation decision. Sub-problem A (payout-destination
  Lexicon) is unblocked and can ship in Phase 3 independently.
- **`own-pds.md`** — parked. v1 leverages users' existing atproto
  identities (typically `bsky.social`); no TorTok PDS is in scope.
  Documents the costs we're avoiding, the risks we've taken on, and
  the triggers that would force us to revisit and write a new ADR.

## Execution risks

These are uncertainties that need a spike or a measurement, not a
design decision. They can invalidate assumptions in the ADRs above —
resolve them early in the phase they threaten.

1. **WebTorrent on React Native / Hermes.** Does WebTorrent's WebRTC
   surface work on Hermes with `react-native-webrtc`? There is a
   `react-native-webtorrent` package but its maintenance status needs
   verification. If it doesn't work, P2P offload collapses to zero and
   every byte comes from R2 — still viable thanks to free egress, but
   degraded. **Blocks Phase 2. This is the single biggest execution
   risk in the rewrite.** Spike first thing in Phase 2.

2. **Vertically-scrolling video feed in RN.** TikTok-style UX is the
   highest execution risk in the rewrite after #1. Memory management
   for simultaneously-loaded players, prefetching, and gesture feel
   all matter. Prototype in Phase 1 before committing to full feature
   parity.

3. **P2P offload ratio in practice.** ADR-008's cost envelope assumes
   ~50% of bytes are served peer-to-peer. This is a guess. Measure
   during Phase 2 prototyping with real (or synthetic multi-client)
   traffic and update the cost model accordingly.

## Deferred decisions

These will become ADRs at a specific phase boundary. Listed here so
they don't get forgotten; each gets a real ADR when the phase that
forces it arrives.

- **AppView running cost estimate (back-of-envelope, 2026-04-29).**
  Indexing and feed generation add a small fixed cost on top of the
  ADR-008 envelope. v1 uses users' existing PDSes (no TorTok PDS) so
  PDS storage and blob egress are zero to us. The ingest path is
  `bsky.social` polling for `app.tortok.video.post` records (one
  persistent worker, ~30s cadence, sub-MB requests). Postgres index
  growth is negligible — ~1KB per record means 10% of a 100k-DAU
  userbase posting daily adds ~300MB/month.

  | Scale | ADR-008 envelope | AppView add-on | Total |
  |-------|------------------|----------------|-------|
  | 1k DAU | ~$31/mo | ~$10/mo (1 ingest worker) | ~$41/mo |
  | 10k DAU | ~$80/mo | ~$20/mo (worker scaling, more polling) | ~$100/mo |
  | 100k DAU | ~$465/mo | ~$50/mo (multiple workers, larger postgres) | ~$515/mo |

  Caveats: assumes `bsky.social` does not rate-limit our polling
  (escalates to relay subscription in Phase 4 if it does); assumes
  ~10% of DAU posts daily, which is a guess and may be off by 2–3× in
  either direction. Detailed estimate is Phase 4 when we measure real
  ingest rates.
- **AppView firehose scale / subscription filtering.** A naive
  subscriber to the full Bluesky firehose drowns. Subscribe only to a
  TorTok-specific relay (nobody is running one yet) or filter
  aggressively at ingest. Phase 4.
- **`did:web` migration UX.** Power users who own a domain may want
  to move from a `bsky.social`-managed `did:plc` to a self-controlled
  `did:web` (per ADR-003 amendment). The atproto mechanism supports
  it; the in-app flow (DNS verification, PLC op, account migration)
  needs designing. Not blocking v1; worth prototyping before we
  promise it.
- **Legacy account migration.** Phase 1 shipped against the legacy
  email/password backend, so a small number of test/team accounts
  exist in the `users` table. Phase 3 retires that table; affected
  accounts re-onboard via atproto OAuth. One-shot, communicated to
  the affected users out of band. Coordinated with Unit 2.5 (v2)
  Phase C of the Phase 3 plan.
- **R2 reliability and backup strategy.** Weekly backup to Backblaze
  B2 (~$5/month) once the catalog warrants it. Not urgent at launch;
  revisit after Phase 4.
- **Fly.io reliability tolerance trigger.** Concrete migration
  trigger (e.g., "two P1s in a quarter, or one P0 with data loss")
  → Hetzner VPS fallback for L2/L3. Define before Phase 0b deploy so
  the decision is mechanical rather than emotional.

---

## What this document does not decide

- **Recording / upload UX.** The current `Record` tab is a stub.
  Design and camera capture are a separate concern.
- **Direct platform monetization via ads or paid content.** TorTok
  does not serve ads, host paid content, or take a revenue cut from
  creator earnings. Creators monetize externally (Patreon, host-read
  sponsorships, direct deals) using trustworthy engagement signals
  published by our PDS, *plus* the first-party fan-allocated
  "support open content" pool (ADR-011). TorTok may transiently
  custody fan funds in the pool rail (Stripe balance) but does not
  profit from custody. See ADR-011 and
  `docs/architecture/open-problems/monetization.md` for the full
  framing.
- **Self-hosted PDS tooling.** Deferred to post-v1 per ADR-005.
- **Payment processing / creator KYC / creator payouts for the V1
  pool rail.** ADR-011 sets the direction (Stripe+USDC-on-Base
  leading candidate, creator KYC accepted) but the rail commitment
  is gated on Apple App Store guidance (P1) and the
  US-incorporation decision (P2). The external-monetization path
  (creators linking to their own Patreon/etc.) is unchanged — no
  tortok-side payment processing needed there.
- **Native desktop (macOS, Windows, Linux).** Expo web covers desktop
  usage for v1; native desktop shells are a later decision.

---

## Appendix A: Phase 0 punch list

This appendix consolidates the concrete work identified in the April 2026
code review. These are the items to execute in Phase 0 of ADR-006 before
any rewrite work begins. File:line references reflect the tree as of
commit `af092d5` (the WebTorrent bridge commit) — some line numbers may
drift slightly because there are uncommitted modifications in
`backend/src/index.ts`, `backend/src/routes/videos.ts`, `backend/Dockerfile`,
and `backend/package.json` (see "Uncommitted state" below).

### A.1 Bugs to fix

**B1. `/auth/me` middleware order** — `backend/src/index.ts`

`authenticateJWT` is wired onto the `/auth/me` route after the auth router
is mounted, so the middleware never runs and valid tokens return 401. Fix:
either wire `authenticateJWT` directly on the route handler in
`routes/auth.ts`, or mount the middleware before the auth router.

Downstream effect: `TorTok/Services/API/AuthManager.swift:26` has a
`// TODO: Validate token and load user` that exists only to work around
this bug. After the fix, delete the TODO and actually call `/auth/me`
on app launch to hydrate the user.

**B2. Refresh-token fiction** — `backend/src/routes/auth.ts:63, 124` and
`TorTok/Services/API/AuthManager.swift:95`

Both register and login responses return `refreshToken: token` — the same
JWT as the access token. The client calls `/auth/refresh` which does not
exist on the server. Fix for v1 simplicity: delete the refresh-token
concept from both sides. Session JWTs can be long-lived; proper refresh
tokens are a v2 concern once we have a clearer session-lifetime story.

**B3. Like-counter drift** — `backend/src/routes/videos.ts:167-189`

`INSERT ... ON CONFLICT DO NOTHING` on the likes table is followed by an
unconditional `UPDATE videos SET like_count = like_count + 1`. When the
user has already liked the video, the INSERT hits the conflict path but
the counter still increments. Fix: check the INSERT's row count and only
update the counter when a new row was actually inserted, or merge both
operations into a single atomic CTE.

**B4. `PATCH /videos/:id/urls` has no ownership check** — new endpoint in
uncommitted `backend/src/routes/videos.ts` (WebTorrent bridge commit)

The endpoint is labelled "admin endpoint" in its docstring but only
requires `authenticateJWT`. Any authenticated user can update any video's
HLS URL and magnet link. Fix: add an ownership check (verify
`req.user.id === video.user_id`) or gate behind an explicit admin role.

**B5. Magnet URI JS injection** — `TorTok/Services/Torrent/WebTorrentBridge.swift:158`

Magnet URI is interpolated into a JavaScript string literal with only
single-quote escaping. A malicious magnet URI can break out of the string
and execute arbitrary JS in the WKWebView. Fix: pass arguments as a JSON
payload and parse inside the webview, or use `callAsyncJavaScript` with
proper argument binding.

*Moot post-Phase 4* — the file is deleted when the Expo client lands.
Still worth fixing because the Swift app is live as a reference during
Phases 0-2 and should not be unsafe to run.

**B6. `P2PResourceLoader` stats subscription is wrong** —
`TorTok/Services/Player/P2PResourceLoader.swift:232-246`

Subscribes to bridge-wide totals instead of per-torrent stats, so every
player shows the aggregate. Fix: add a per-torrent stats API to the JS
bridge and subscribe to that.

*Moot post-Phase 4* — same caveat as B5.

### A.2 Security footguns (not critical bugs, must fix before v1 ships)

**S1. JWT secret default** — `backend/src/middleware/auth.ts:4`

Default value `'development-secret-change-in-production'` is used when
`JWT_SECRET` is unset. If the env var is missing in production, JWTs are
forgeable by anyone who reads the source. Fix: throw at startup if
`JWT_SECRET` is missing or equals the default. Do this in Phase 0 even
though we're moving to a PDS in Phase 3 — Cloud Run deploys today and
could be misconfigured tomorrow.

**S2. HLS URL scheme validation** — `backend/src/middleware/validate.ts`

`Joi.string().uri()` accepts any scheme, including `http://`, `file://`,
`gopher://`, etc. SSRF risk if any code path ever fetches these URLs
server-side. Fix: `Joi.string().uri({ scheme: ['https'] })`. Same applies
to the new `PATCH /videos/:id/urls` body validation.

**S3. Password policy is thin** — `backend/src/middleware/validate.ts`

`Joi.string().min(8)` with no complexity or breach check. Not a blocker
but notably weaker than what we'll want when the PDS takes over auth in
Phase 3. For the interim: bump minimum to 10 and add a small common-password
blocklist (`123456789`, `password1`, etc.) or integrate zxcvbn.

**S4. `jest` missing from devDependencies** — `backend/package.json`

`"test": "jest"` but `jest` isn't in `devDependencies`, so `npm test`
fails on a clean install. Either install jest or remove the script.

### A.3 Libtorrent cleanup — files to delete and edit

**Delete outright (will break the build if edits in A.3.2 aren't done
in the same commit):**
- `TorTok/Services/Torrent/TorrentEngine.swift` (218 lines of stubs,
  every method is `// TODO`)
- `TorTok/Models/TorrentInfo.swift` (orphaned once `TorrentEngine.swift`
  is gone — the real `TorrentInfo` lives inside `WebTorrentBridge.swift`)

**Edits required in the same commit:**
- `TorTok/Package.swift:33` — remove `"LibTorrentBridge"` from
  `TorTok` target dependencies
- `TorTok/Package.swift:43-59` — remove the `LibTorrentBridge` target
  definition (points at `TorTok/Services/Torrent/Bridge` which doesn't
  exist, with a hardcoded `../../../../../libtorrent/include` header
  path)
- `TorTok/Package.swift:68` — remove `cxxLanguageStandard: .cxx17`
- `TorTok/TorTokApp.swift:14` — remove `torrentEngine` property
- `TorTok/TorTokApp.swift:31` — remove `torrentEngine` initialization
- `TorTok/TorTokApp.swift:102` — remove `torrentEngine` injection

**Requires manual Xcode UI action (cannot be done via Edit tool):**
- `TorTok.xcodeproj/project.pbxproj` — delete `TorrentEngine.swift` from
  the project navigator, choose "Move to Trash". Xcode regenerates the
  pbxproj; doing this by hand-editing the file is fragile.

**Dead code, safe to delete independently of the libtorrent cleanup:**
- `TorTok/TorTokDemo.swift` (379 lines; file's own comment says
  "NOT used in the main TorTok app")

### A.4 Documentation cleanup

**Already done (April 2026):**
- Deleted the pre-Opus architecture docs under `docs/architecture/`,
  `docs/guides/`, and `docs/deployment/` (ActivityPub + libtorrent +
  Swift-era material). Salvageable content was folded into this
  decisions doc or into `docs/architecture/open-problems/` before
  deletion.
- Created `docs/architecture/open-problems/` with three unresolved
  design problems (`moderation.md`, `view-counting.md`,
  `seeding-policy.md`), each carrying a `Must resolve by:` header.
- Created `CLAUDE.md` at the repo root with read-order and
  phase-aware stop-and-ask rules for future sessions.

**Still outstanding:**

The `designs/mvp-*.md` specifications (`mvp-specification.md`,
`mvp-ios-specification.md`, `mvp-video-reels-specification.md`)
describe the Swift-era product. They are factually superseded by
ADR-004 and ADR-006 but worth keeping as historical context for what
the Swift prototype was meant to be. Leave them alone; they do no
harm and they document user-facing intent we may want to revisit
when designing the Expo rewrite.

The repo root has a collection of stale status docs from the pre-Opus
era that aren't referenced by anything and clutter the root listing:
- `BUILD_STATUS.md`
- `READY_TO_RUN.md`
- `QUICK_START.md`
- `START_HERE.md`
- `XCODE_SETUP_COMPLETE.md`
- `HOW_TO_RUN.md`

Recommendation: move these to `docs/archive/` rather than deleting, so
the git history is searchable without cluttering the repo root. Also
review `BACKEND_DEPLOYMENT.md` and `README.md` to confirm they reflect
the current backend — both predate the WebTorrent bridge commit
(`af092d5`) and are likely stale in parts.

### A.5 Uncommitted state

The working tree has uncommitted modifications that appear to be
follow-up work on the WebTorrent bridge commit (`af092d5`), not bug
fixes:

- `backend/Dockerfile` — adds `COPY content ./content` for seed content
- `backend/package.json` — adds `webtorrent` runtime dep and types
- `backend/src/index.ts` — adds `/content` static HLS route, seeder
  initialization, `/seeder/stats` endpoint, SIGTERM graceful shutdown
- `backend/src/routes/videos.ts` — adds `PATCH /videos/:id/urls`
  (the endpoint with B4)

Untracked files that are part of the same change:
- `backend/src/services/seeder.ts` — the `SeederService` class
- `backend/content/tortok-test-video/` — seed video assets
- `test-content/update-video-url.mjs` — client script to call the
  new PATCH endpoint

Before starting Phase 0, these should either be committed as-is (they
look coherent) or rebased/reworked so the bug fixes in A.1 land on a
clean base. The B4 authorization bug is in this uncommitted work and
should be fixed before the commit lands, not after.

### A.6 Architectural acceleration

The seeder-in-Cloud-Run mismatch flagged in ADR-005 is now more acute
than originally described. The uncommitted changes wire the backend
to serve static HLS content directly from `backend/content/` via
`express.static`, which means a second stateful concern (persistent
file storage) is now coupled to the stateless Cloud Run container
alongside the WebTorrent seeder's in-memory state. Two stateful
concerns in a stateless runtime is worse than one.

This doesn't change any decision — ADR-005 already calls for extracting
the seeder to a separate worker in Phase 3 — but it raises the priority.
If we ship any more features on top of this architecture before Phase 3
lands, the blast radius of the eventual extraction grows. Consider doing
the extraction as part of Phase 0 instead of waiting for Phase 3.
