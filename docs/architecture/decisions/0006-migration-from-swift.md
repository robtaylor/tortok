# Decision 0006: Migration path from the Swift prototype

**Current architecture:** [Architecture overview](../README.md)

**Status:** Accepted. Phase status is not kept here: see the phases table in [`CLAUDE.md`](../../../CLAUDE.md) and the [plans](../../plans/). The phase notes below were edited after acceptance and have gone stale. Phase 3 scope revised by [Decision 0019](0019-v1-uses-existing-pds-via-oauth.md); the AppView's data source by [Decision 0017](0017-appview-postgres-is-a-rebuildable-index.md).

Each phase below is independently shippable. If we stop at the end of any
phase, we have a working product; we just have fewer of the features.

**Phase 0a — Clean house.**
- Commit the uncommitted WebTorrent seeder wiring as a coherent unit,
  with B4 (the `PATCH /videos/:id/urls` authorization bug) fixed
  inline before the commit lands.
- Delete libtorrent stubs (`TorTok/Services/Torrent/TorrentEngine.swift`,
  `TorTok/Models/TorrentInfo.swift`, `LibTorrentBridge` target in
  `Package.swift`, references in `TorTokApp.swift`). See Appendix A.3
  for the full kill-list.
- Fix the bugs flagged in Appendix A.1: `/auth/me` middleware order,
  refresh-token fiction, like-counter drift, `PATCH /videos/:id/urls`
  authorization, magnet-URI JS injection, `P2PResourceLoader` stats
  subscription.
- Address the security footguns in Appendix A.2: JWT secret default,
  HLS URL scheme validation, password policy, missing jest dep.
- Mark pre-Opus design docs as superseded (this document).
- Keep the Swift app runnable as a reference implementation while the
  rewrite proceeds.

**Phase 0b — Deploy to Fly.io and stand up seeder infrastructure (per Decision 0008).**

Status: **Complete** — 2026-04-12

All four layers of Decision 0008 are deployed and verified:

- ✅ **Backend monolith on Fly.io** — `tortok-api.fly.dev` (lhr).
  Express + embedded seeder, Fly Postgres. Expand to additional
  regions once traffic justifies it.
- ✅ **L1 — R2 origin storage.** Cloudflare R2 bucket with public
  access. Video HLS segments served via R2 CDN URL. Backend
  `express.static` route for `/content` retained as fallback but
  new content points at R2.
- ✅ **L2 — Standalone seeder on Fly.io.** `tortok-seeder.fly.dev`
  (lhr). Pull-through cache: polls API for videos, downloads HLS
  from R2, seeds via WebTorrent. Persistent volume for content
  cache. Same Docker image as L4.
- ✅ **L3 — Own tracker.** `tortok-tracker.fly.dev` (lhr).
  `bittorrent-tracker` with WSS. Client and seeder announce lists
  prefer our tracker, community trackers as fallback.
- ✅ **L4 — Community seeder.** Same Docker image as L2 with
  self-hosting guide (`seeder/SELF-HOSTING.md`) covering Docker,
  Unraid, Synology DSM, TrueNAS SCALE, Umbrel.
- ✅ **STUN/TURN.** coturn on Fly.io (`tortok-turn.fly.dev`).
  Time-limited HMAC credentials served via `/turn/credentials`
  API endpoint. Integrated into iOS WebTorrent bridge and
  standalone seeder.
- Server-side seeding policy: **demand-pull caching only** at
  launch. Pre-warming strategies (most-views, trending,
  recently-added) are documented for later — see
  `open-problems/seeding-policy.md`.

**Phase 1 — Expo skeleton.**

Status: **Complete** — 2026-04-14

- Scaffold the Expo project. Pick a navigation approach (Expo Router) and
  a state approach (React Query + Zustand or similar).
- Reimplement login against the existing backend API (not atproto yet).
  This proves the auth flow and lets us throw away `AuthManager.swift`
  mentally even if we don't delete it yet.
- Implement a basic vertical feed with `expo-video` or `react-native-video`.
  Target: visual parity with the current Swift feed, no P2P yet.
- Add UI automation tests. We switched from the originally-planned Maestro
  to **Detox** (JS, runs real iOS/Android builds via XCUITest/Espresso,
  uses `testID` props for element matching). Detox integrates more
  cleanly with the Expo toolchain and gave us better sync handling for
  dev builds. Coverage: registration, login, feed, profile, logout, tab
  navigation, session persistence — 16 tests, all passing.

Phase 1 delivered: Expo app shell (auth/feed/profile/record-stub tabs)
with feature parity to the Swift prototype minus P2P — the gaps
identified during the Phase 1 closeout audit (profile follower/following/
video counts and bio, per-video buffering indicator, per-video error
overlay with retry, tap-to-toggle play/pause) were all closed before
marking the phase complete.

**Phase 2 — Cross-platform P2P.**
- Integrate WebTorrent in the Expo client. This requires verifying that
  WebRTC works in the chosen JS engine (Hermes may need polyfills; see
  open questions below).
- Replace HLS-only playback with P2P-backed streaming, falling back to
  HTTP webseeds when the swarm is cold.
- Confirm iOS, Android, and web all play the same video.
- At this point we have a working cross-platform TorTok with no federation.
  Shippable as an alpha.
- **Cleanup gate:** delete the Decision 0009 WebTorrent spike route
  (`tortok/app/spike.tsx`) and its auth-guard exemption in
  `tortok/app/_layout.tsx` once real playback is wired up. The spike
  exists only to de-risk the engine-compat question; it has no purpose
  once the production integration lands. Don't carry it into Phase 3.

Phase 2 delivered: WebTorrent integrated end-to-end across iOS sim,
Android emulator, and Expo web. Hermes runs the JS WebTorrent client
with `react-native-webrtc` for the WebRTC layer; on web the Service
Worker bridge isn't built yet so the client extracts the `ws=`
webseed URL from the magnet and plays directly over HTTP. Two-iOS-sim
peer test on 2026-04-29 measured **89–91% P2P offload** with two
peers (per-torrent log line `[webtorrent] offload: …` added in
`tortok/lib/webtorrent/client.ts`). Spike route deleted. Real-device
P2P validation (mobile data + NAT) was deferred — an execution risk
to revisit when we have devices in hand. Client seeding policy
(Decision 0009 v1) was scoped out of Phase 2 by mutual agreement; the
plan in `tortok/lib/webtorrent/seedPolicy.ts` and `useSeedPolicy.ts`
will land post-Phase 3 once we know how PDS-driven session lifetimes
interact with foreground-only seeding.

**Phase 3 — atproto integration via the user's existing PDS.**

Scope changed 2026-04-29: the original Phase 3 forked our own PDS and
ran a custodial signup. That has been reversed (see amendments to
Decision 0003 and Decision 0007). Phase 3 now leverages users' existing atproto
identities and ships materially smaller.
- Define and publish the `app.tortok.video.post` Lexicon (Decision 0002).
- Add `@atproto/api` to the client. Login becomes atproto OAuth against
  the user's PDS (typically `bsky.social`).
- Publish video as a signed `app.tortok.video.post` record into the user's
  PDS repo: upload thumbnail as a blob via the user's PDS, then create
  the record. Magnet is generated client-side as it is today.
- Retire the legacy email/password backend and the legacy video-post
  endpoint. With no released users, there is no migration to perform.
- **Revisit web token storage.** Phase 2 accepted expo-secure-store's
  web fallback to `localStorage` (readable by any XSS on the domain).
  atproto OAuth produces tokens that should live in `HttpOnly` /
  `SameSite` cookies on the web build. Tracked in
  `tortok/stores/auth.ts:18`.
- **Open question:** whether TorTok ever runs its own PDS is parked in
  `docs/architecture/open-problems/own-pds.md`, with documented
  triggers to revisit (Bluesky restricting our Lexicon, onboarding
  friction in user research, brand or moderation control needs).

**Phase 4 — AppView cutover.**
- Stand up the AppView as a separate service. It subscribes to our
  own PDS's repo event stream, filters for `app.tortok.video.post` records,
  indexes them in Postgres, and serves feed endpoints.
- Client feed endpoint switches from the legacy feed API to the
  AppView. The legacy feed endpoint is retired.
- At this point the backend is three services: PDS, AppView, seeder
  worker. Each has a clear job.

**Phase 5 — Retire Swift.**

Status: **Complete** — 2026-04-14 (executed early).

The Swift codebase was deleted immediately after Phase 1 closeout rather
than carried as a reference implementation through Phases 2–4. Rationale:
the project was never released, so there are no "remaining consumers" to
migrate and no value in a live reference implementation — the Expo app
reached Swift parity in Phase 1, the Swift prototype's architectural
intent is captured in the decision records and `designs/` specs, and keeping a dead
tree of ~230KB of Swift adds navigation friction for every future
session. Originally-planned `TorTok/` removal deferred until now so the
parity audit at Phase 1 closeout had a reference to check against; once
that audit passed, the Swift tree had no further purpose.

Historical references to specific Swift files in this document and in
`designs/` are preserved as-is — they document what the Swift prototype
was, not what still exists.
