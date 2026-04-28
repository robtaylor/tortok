# TorTok Architecture Decisions

Status: **Draft for review** — 2026-04-11

This document records the load-bearing architectural decisions for TorTok as of
April 2026. It replaces a set of pre-Opus design docs that assumed libtorrent,
ActivityPub federation, and Swift as the only client; those docs have been
deleted (see Appendix A.4). The `designs/mvp-*.md` specifications are retained
as historical context for the Swift prototype.

Unresolved design questions live in `docs/architecture/open-problems/`, each
with a `Must resolve by:` header stating the phase that forces the decision.

Each decision below follows a lightweight ADR format: context, decision,
consequences, alternatives. If a decision turns out to be wrong, add a new ADR
with `Supersedes: ADR-NNN` rather than editing the old one.

---

## ADR-001: Torrent engine is WebTorrent, end to end

**Status:** Accepted

**Context.** The current tree has two torrent engines: a stubbed libtorrent
C++ bridge (`TorTok/Services/Torrent/TorrentEngine.swift`, never implemented)
and a working WebTorrent bridge running in a hidden `WKWebView`
(`TorTok/Services/Torrent/WebTorrentBridge.swift` + `webtorrent-bridge.html`).
The backend seeder is also WebTorrent. The libtorrent path was aspirational
and never functioned.

**Decision.** Use WebTorrent exclusively across client and server. Delete the
libtorrent stubs. In the new client (see ADR-004) WebTorrent will run in the
host JavaScript runtime directly — no `WKWebView` bridge, no
`AVAssetResourceLoaderDelegate` plumbing.

**Consequences.**
- One engine across client seeders, viewers, and the backend origin seeder.
- Peering is limited to WebTorrent-compatible peers (WebRTC transport). We
  cannot swarm with classic libtorrent peers over TCP/uTP.
- Mitigation: every video has an HTTP webseed fallback served from the
  backend so new videos can be streamed while the swarm warms up.
- ~1000 lines of Swift bridging code (`WebTorrentBridge.swift`,
  `P2PResourceLoader.swift`, parts of `VideoPlayer.swift`) are deleted, not
  rewritten, because WebTorrent in a JS runtime streams to `<video>` natively
  via MediaSource.

**Alternatives ruled out.**
- **libtorrent (C++ via iTorrent / Rasterbar).** Native swarm compatibility,
  but requires a C++ toolchain and platform-specific bridge per target. No
  viable browser story. Cost dominates benefit for our use case.
- **Pure HLS/DASH over a CDN.** Defeats the purpose of TorTok.
- **Hybrid libtorrent + WebTorrent.** Two engines, two bug surfaces. We would
  be the smallest project in the world trying to maintain both.

**Tuning parameters (starting defaults).**
- `httpDownloadProbability: 0.1` — probability the client fetches a piece
  from the HTTP webseed rather than a peer, even when peers are available.
  This is PeerTube's production default and keeps the webseed warm so it
  doesn't fall off Cloudflare edge caches; revisit once we have real P2P
  offload numbers in Phase 2.
- Client-side seeding policy (when and how much the Expo app seeds on
  behalf of other peers) is unresolved — see
  `docs/architecture/open-problems/seeding-policy.md`.

---

## ADR-002: Federation protocol is AT Protocol

**Status:** Accepted

**Context.** Publishing is the central design question. We need federation,
identity, and attestation. Options surveyed: ActivityPub (the PeerTube /
Loops lineage), AT Protocol (Bluesky), Nostr, and rolling our own.

**Decision.** Adopt AT Protocol. Define a custom Lexicon,
`tortok.video.post`, with this shape:

```json
{
  "$type": "tortok.video.post",
  "magnetUri": "magnet:?xt=urn:btih:...",
  "infoHash": "hex",
  "durationMs": 15230,
  "aspectRatio": "9:16",
  "caption": "string (max 300 chars)",
  "thumbnailBlob": { "$type": "blob", "ref": "...", "mimeType": "image/jpeg" },
  "hashtags": ["#tortok", "#demo"],
  "hlsFallbackUrl": "https://webseed.tortok.example/video/abc.m3u8",
  "createdAt": "2026-04-11T12:00:00Z"
}
```

Videos are published as signed AT Protocol records. Federation is via the
standard atproto pipeline: client → PDS → firehose → AppView.

**Consequences.**
- Attestation comes for free: every record is cryptographically signed by
  the author's DID. No bolt-on signing layer.
- Account portability: users can move PDS without losing handle, followers,
  or post history.
- We get a real schema (Lexicons) instead of hand-rolled JSON.
- The firehose + AppView pattern is designed for million-user-scale
  aggregation; we are not inventing scalability.
- Coupling: atproto has one dominant implementer (Bluesky PBC). Lexicon
  namespace governance (who owns `tortok.*`?) is not fully settled. We
  mitigate by running our own AppView instead of depending on Bluesky's
  infrastructure to index TorTok records.

**Alternatives ruled out.**
- **ActivityPub (PeerTube / Loops).** Server-to-server push model scales
  linearly with followers and requires every instance to be reachable.
  PeerTube has hit this ceiling repeatedly. Account portability is weak;
  identity is tied to the originating server. Attestation is not native.
- **Nostr (NIP-71 video events).** Event model is strong and keypair-native,
  but designed for small text posts. Media publishing is underspecified.
  Relay economics are fragile. No schema system. No account-recovery story;
  losing a key loses the account.
- **Custom protocol.** We would spend the next year building what AT
  Protocol already ships.
- **W3C DIDs + Verifiable Credentials alone.** Gives us identity and
  attestation but no federation primitive. We would still need to invent
  the publish/aggregate layer.

---

## ADR-003: Identity uses DIDs — `did:plc` default, `did:web` opt-in

**Status:** Accepted. Amended 2026-04-29 — v1 no longer runs a custodial
TorTok PDS; users authenticate via their existing atproto identity
(typically `bsky.social`). See "Amendment 2026-04-29" below.

**Context.** AT Protocol accounts are DIDs. Two methods are practical:
`did:plc` (PLC directory, currently operated by Bluesky PBC) and `did:web`
(DNS-based, self-sovereign). `did:key` is unsuitable because AT Protocol
assumes keys can rotate.

**Decision (as amended 2026-04-29).**
- Users authenticate via the atproto identity they already have. In
  practice that means `bsky.social` for the overwhelming majority;
  any atproto-compatible PDS works.
- The user's home PDS holds their rotation key, password, recovery
  flow, and blob storage. We hold none of those.
- We still build our own AppView and our own `tortok.video.post`
  Lexicon (see ADR-002, ADR-005). Records live in the user's PDS
  repo; we index them in our AppView.
- **`did:web` opt-in for sovereigns.** Power users who own a domain
  can opt into `did:web` per the standard atproto upgrade path. We
  document the DNS configuration; we do not host identity documents
  for them. Self-custody happens via the standard atproto migration
  flow against the user's PDS, not against TorTok.
- Whether to ever run our own PDS is now an open problem
  (`docs/architecture/open-problems/own-pds.md`). Triggers to revisit
  are documented there.

**Amendment 2026-04-29.** The original Decision below specified a
custodial v1 in which TorTok ran a PDS, generated `did:plc` identities
on signup, and held rotation keys server-side. That model has been
reversed. The reasoning, costs, and triggers for revisiting are in
ADR-007's Amendment block and in `open-problems/own-pds.md`.

**Original decision (pre-amendment, retained for context).**
- Signup creates a `did:plc` identity behind the scenes. The user does
  not see this — the flow is email + password + captcha, with no
  atproto terminology in the UI (see ADR-007).
- **v1 is custodial.** Rotation keys are held server-side by our PDS
  (see ADR-005). Users reset their password and recover their account
  the same way they would on any standard app. Key material lives in a
  dedicated secrets store, not the primary application database.
- **Post-v1: opt-in self-custody.** A settings screen lets users
  upgrade to user-held keys. At that point the rotation key moves from
  our servers into the platform secure store (iOS Keychain, Android
  Keystore, WebCrypto on web, all accessed via Expo SecureStore's
  cross-platform API).

**Consequences (as amended).**
- v1 ships materially faster. No PDS fork, no custodial key store,
  no signup spam ladder, no email/password complexity.
- We surface "sign in with Bluesky" at the user level. The product
  hypothesis (see ADR-007 amendment) is that this is a credibility
  and community signal, not a leak of plumbing.
- We accept dependency on the user's PDS. If `bsky.social` rate-limits
  third-party Lexicons or refuses our records, our users can't post
  through it. This is the dominant new risk; it is monitored as a
  trigger in `open-problems/own-pds.md`.
- We accept that we cannot deplatform a problematic user at the
  protocol layer. Our only lever is the AppView (refuse to index).
  A user banned from `bsky.social` for unrelated reasons loses TorTok
  access until they migrate PDS.
- Account portability and self-custody are now atproto-standard from
  day one (no upgrade flow needed).
- `did:plc` still depends on PLC directory availability. We should
  monitor proposals to decentralize PLC and follow the consensus
  migration path if one emerges.

---

## ADR-004: Client is Expo + React Native + TypeScript

**Status:** Accepted

**Context.** The current Swift/SwiftUI prototype is iOS-only. Cross-platform
reach (iOS, Android, web) is now an explicit requirement, and the atproto
client SDK is TypeScript-first. Choosing the client language locks in the
codebases we maintain for years.

**Decision.** Rewrite the client in Expo (React Native) with TypeScript.
Targets: iOS, Android, and web via React Native Web / Expo Router.

**Why.**
- Cross-platform is a hard requirement. Swift cannot target Android or web.
- `@atproto/api` is the reference implementation of the AT Protocol client;
  using it in its native language is materially simpler than wrapping XRPC
  by hand in Swift + Kotlin + JS.
- WebTorrent is a JavaScript library. Running it in the same JS runtime as
  the app removes the `WKWebView` bridge entirely. The current Swift
  `P2PResourceLoader.swift` + `WebTorrentBridge.swift` (~1000 lines)
  disappears rather than being ported.
- The backend is already TypeScript (ADR-005). One language across the stack
  means shared types, shared validation, and a single hiring pool.
- Expo gives us OTA updates, a managed workflow for the 80% case, and
  ejection to bare React Native when we need native modules.

**Why not the alternatives.**
- **Stay in Swift, add Kotlin for Android.** 2–3x engineering cost, no
  shared business logic, and still no web story. Rejected.
- **Flutter.** Excellent UI kit, but the Dart ecosystem for atproto and
  WebTorrent is near-zero. We would be rebuilding both.
- **PWA only.** iOS Safari's PWA sandbox is too weak for a short-form video
  app: background restrictions, HLS-only via native controls, no serious
  push story.
- **Capacitor / Tauri wrapping a web app.** Viable, but Expo gives us the
  same cross-platform story with better access to native modules (camera,
  file system, secure store) and a more mature OTA update pipeline.
- **Hybrid: Swift player + TS networking via JavaScriptCore.** Clever,
  ultimately worse — still one codebase per platform, plus a JS bridge.

**Consequences.**
- We throw away ~3500 LOC of Swift. The WebTorrent bridge, AVFoundation
  player, and UI tests are lost. Most of it was prototype quality.
- React Native video playback for a TikTok-style vertically-scrolling feed
  needs care. This is the single biggest execution risk in the rewrite and
  must be prototyped before committing to full feature parity.
- We gain: one codebase, three platforms, a first-class atproto client,
  a simpler P2P stack, shared types with the backend, and a much larger
  contributor pool.

---

## ADR-005: Backend stays Node + TypeScript; evolves into an AppView

**Status:** Accepted

**Context.** The existing backend (`backend/`) is Node/Express/Postgres
running on Cloud Run, with a WebTorrent seeder glued into the same process.
The review flagged that the seeder-in-Cloud-Run is architecturally wrong
(stateless container + stateful torrent engine), and the `/auth/me`, refresh
token, and like-counter bugs need fixing regardless.

**Decision.** Keep Node/TypeScript. Evolve the backend in two directions:

1. **AppView.** Subscribe to the AT Protocol firehose (via a relay),
   filter for `tortok.video.post` records, index them in Postgres, and
   serve feed endpoints to the client. Use `@atproto/api` and
   `@atproto/sync` for the heavy lifting.
2. **Seeder worker.** Move the WebTorrent seeder out of the Cloud Run
   container into a separate long-lived worker (Cloud Run jobs, a VM,
   or a persistent container platform). The AppView talks to the seeder
   over an internal API, not in-process.

**v1: host our own PDS.** We run a TorTok-branded PDS from day 1. This
reverses my earlier instinct to defer PDS hosting. The reason is UX: the
only way to keep atproto plumbing invisible to users (ADR-007) is to
own the signup surface ourselves. Users do not pick a PDS, never see
"atproto" or "Bluesky", and never need to know what a DID is. TorTok
looks and feels like a normal short-form video app.

**PDS implementation.** Fork the reference PDS from
`bluesky-social/atproto`. It is Node/TypeScript, which matches our
stack. Strip what we don't need (e.g., Bluesky-specific lexicons we're
not using) rather than reinvent. A ground-up build-from-spec is on the
table only if the fork becomes more painful than the rewrite.

**AppView in v1** subscribes primarily to our own PDS's repo events —
we control the source, so we don't need to drink from the wider atproto
firehose on day 1. Third-party firehose subscription becomes a post-v1
feature if and when we want to cross-federate with other PDSes.

**Consequences.**
- Reuses existing backend code and deployment pipeline.
- Forces us to fix the seeder-in-Cloud-Run bug as part of this
  migration, which is correct.
- We take on a new stateful service: the PDS. This means running
  persistent storage, operating custodial key material, handling
  password-reset flows, and becoming a compliance target for user data.
  Non-trivial, and should not be minimized.
- In exchange, we own the UX end-to-end. That is the whole point.
- If cross-federation with other atproto apps later becomes a priority,
  we extend the AppView to subscribe to third-party firehoses. Our
  records are already valid atproto records, so they're visible to
  anyone who wants to index them.

---

## ADR-006: Migration path from the Swift prototype

**Status:** Accepted

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

**Phase 0b — Deploy to Fly.io and stand up seeder infrastructure (per ADR-008).**

Status: **Complete** — 2026-04-12

All four layers of ADR-008 are deployed and verified:

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
- **Cleanup gate:** delete the ADR-009 WebTorrent spike route
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
(ADR-009 v1) was scoped out of Phase 2 by mutual agreement; the
plan in `tortok/lib/webtorrent/seedPolicy.ts` and `useSeedPolicy.ts`
will land post-Phase 3 once we know how PDS-driven session lifetimes
interact with foreground-only seeding.

**Phase 3 — atproto integration via the user's existing PDS.**

Scope changed 2026-04-29: the original Phase 3 forked our own PDS and
ran a custodial signup. That has been reversed (see amendments to
ADR-003 and ADR-007). Phase 3 now leverages users' existing atproto
identities and ships materially smaller.
- Define and publish the `tortok.video.post` Lexicon (ADR-002).
- Add `@atproto/api` to the client. Login becomes atproto OAuth against
  the user's PDS (typically `bsky.social`).
- Publish video as a signed `tortok.video.post` record into the user's
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
  own PDS's repo event stream, filters for `tortok.video.post` records,
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
intent is captured in the ADRs and `designs/` specs, and keeping a dead
tree of ~230KB of Swift adds navigation friction for every future
session. Originally-planned `TorTok/` removal deferred until now so the
parity audit at Phase 1 closeout had a reference to check against; once
that audit passed, the Swift tree had no further purpose.

Historical references to specific Swift files in this document and in
`designs/` are preserved as-is — they document what the Swift prototype
was, not what still exists.

---

## ADR-007: Signup UX and spam prevention

**Status:** Accepted. Amended 2026-04-29 — signup is now atproto OAuth
against the user's existing PDS, not a custodial email + password flow.
See "Amendment 2026-04-29" below.

**Amendment 2026-04-29.** This ADR originally specified a clean,
TorTok-branded signup with atproto as invisible backend plumbing. That
stance has been reversed. The new flow is atproto OAuth against the
user's existing PDS — typically `bsky.social`. The spam-prevention
ladder below largely becomes N/A: the user's PDS handles signup spam
for us. Per-user rate limits at our AppView remain in scope.

The product hypothesis underlying the original ADR ("exposing Bluesky
at the user level is what we don't want") has flipped. The new
hypothesis is that surfacing Bluesky on signup is a *credibility*
signal — established protocol, recognised brand, real account, you
arrive in TorTok already plugged into a community. We will revisit
this if onboarding-funnel data contradicts it.

The original Context, Decision, escalation ladder, and Alternatives
ruled out are retained below for the audit trail. They no longer
describe the v1 flow. The question of whether TorTok ever runs its
own PDS — for any reason: signup branding, Bluesky restricting our
Lexicon, protocol-layer moderation control — is now an open problem
in `docs/architecture/open-problems/own-pds.md` with documented
triggers to revisit.

**Decision (as amended 2026-04-29).**

Signup and login are **atproto OAuth against the user's PDS**. The
client embeds the standard atproto OAuth flow (`@atproto/api`). Most
users land on `bsky.social`; users on third-party PDSes work the same
way. We do not run an auth endpoint of our own; we do not store
passwords; we do not generate `did:plc` identities; we do not hold
rotation keys.

We still publish a `tortok.video.post` Lexicon (ADR-002), still run our
own AppView (ADR-005), and still write video records signed by the
user's repo key into the user's PDS via `@atproto/api`.

**Spam prevention (as amended).**

The user's PDS handles signup-time spam (Bluesky uses Turnstile;
third-party PDSes vary). We retain authority over per-user rate limits
at the AppView ingest and at our own backend endpoints (e.g., upload
quotas, posting cadence). The escalation ladder below is preserved as
a reference for the AppView surface, not the signup surface.

---

**Original Context (pre-amendment).** Earlier drafts of ADR-005 assumed
users would bring their own atproto identity from an existing PDS
(typically bsky.social) and log in via atproto OAuth. Research
confirmed Bluesky themselves dropped SMS verification in February 2024
in favour of CAPTCHA-only signup, and exposing Bluesky at the user
level is explicitly not what we want for TorTok — we want a clean,
familiar, branded experience where atproto is backend plumbing the
user never sees. This ADR defines the signup flow and the
spam-prevention strategy that sits in front of it.

**Original Decision (pre-amendment).**

Signup is **email + password + CAPTCHA**. Nothing else. No phone
number, no "pick a PDS" step, no mention of Bluesky, atproto, DIDs,
handles, or anything else protocol-specific in the UI.

**CAPTCHA choice: Cloudflare Turnstile** as the default. Rationale:
- Usually invisible to the user (shows a puzzle only when risk is
  elevated), which matches the "simple flow" goal
- Free at our expected scale
- Single drop-in widget with server-side verification
- Cloudflare operates a huge share of the web, so false positives on
  legitimate users are rare

**hCaptcha** is an acceptable fallback if Turnstile doesn't work out in
practice — they are functionally interchangeable for our use case and
switching later is a one-day job.

**Signup flow (server side).**
1. Client POSTs email, password, and Turnstile token to our signup
   endpoint
2. Backend verifies the Turnstile token with Cloudflare
3. Backend creates a `did:plc` identity via our PDS
4. Backend generates the rotation key server-side (custodial per
   ADR-003) and stores it in a dedicated secrets store (not the main
   application database)
5. Backend hashes the password with argon2id and stores the credential
6. Backend sends a verification email containing a one-time activation
   link
7. Backend returns a session token; the client lands on the home feed
   with a banner asking the user to verify their email before they
   can post
8. When the user clicks the activation link, the account is marked as
   email-verified and posting is unlocked

**Password reset** is a standard email-link flow. Because we hold the
rotation key custodially, password reset recovers full account access.

**Escalation ladder (in increasing order of cost and complexity):**
1. Turnstile default settings — ship with this
2. Tighten Turnstile risk settings if abuse appears
3. Per-IP and per-email rate limits at signup (1–2 days of work)
4. Account-age gating on first post (no posting for N hours after
   signup; N tunable)
5. Posting rate limits keyed on account age (new accounts post slower)
6. Build or contract a phone-verification labeler (weeks of work; only
   if spam is a business-threatening problem)
7. Proof-of-personhood integration (Worldcoin or similar) if the abuse
   is sophisticated enough to warrant it

We stop climbing the ladder as soon as abuse is under control. Most
consumer apps of TorTok's shape and scale live comfortably at rung 1–3.

**Consequences.**
- Users see a normal signup flow. Zero atproto vocabulary.
- We take on standard email/password auth complexity: password
  hashing (argon2id), email delivery (pick a provider in Phase 3),
  reset tokens, email verification gating. None of this is novel; all
  of it is real work.
- We take on custodial key management for rotation keys. This is the
  most sensitive part of the stack — treat the secrets store with
  extra care (KMS, audit logging, least-privilege access).
- Users never think about Bluesky. The atproto substrate is invisible,
  which is both the goal and the reason we're running our own PDS.

**Alternatives ruled out.**
- **SMS verification.** Cost, privacy friction, international
  accessibility problems, and a signal that's easily bypassed with
  VoIP numbers. Bluesky reached the same conclusion in Feb 2024.
- **OAuth via atproto (bring-your-own-PDS).** Would expose
  "sign in with Bluesky" at the user level. Explicitly not what we
  want.
- **Magic links / passwordless.** Arguably better UX, but puts email
  delivery on the critical auth path. Defer — easy to swap in later
  if we decide passwords are the wrong call.
- **Social login (Google, Apple).** Adds platform dependencies and
  complicates the "cross-platform, own the UX" story. Defer to a
  later ADR if user research suggests it matters.

**Concrete defaults for the escalation ladder.**

These are the numbers we ship with. They are adjustable in config
without a code change.

- **Rung 3 — signup rate limits.** 5 signups per IP per hour, 3 signups
  per email address per day. Tighten both by 5× the moment abuse shows up.
- **Rung 4 — account-age gating.** No posting for the first hour after
  signup (plus email verification, which is already required). This is
  cheap to add and catches the crudest abuse patterns.
- **Rung 5 — posting rate limits by account age.**
  - First 7 days: 3 posts/day, 10 follows/day, 50 likes/day.
  - Established accounts: 10 posts/hour, 30 follows/hour, 100 likes/hour.
  These limits are defaults, not spam thresholds — legitimate heavy
  users will never hit them; spammers will hit them on the first
  minute. Return 429 with a visible cooldown timer in the UI.

Broader content-moderation policy (reporting, auto-hide thresholds,
NSFW classification, labeler integration) is unresolved — see
`docs/architecture/open-problems/moderation.md`.

---

## ADR-008: Seeder, storage, and CDN infrastructure

**Status:** Accepted

**Context.** ADR-005 extracts the WebTorrent seeder from the Express
process but does not specify where it runs, how origin storage is
hosted, or how users can contribute to the swarm. Cost, geographic
diversity, and community runnability are explicit goals: the
infrastructure must be cheap enough to self-fund, geographically
distributed enough to serve a global audience without embarrassing
latency, and runnable on the same software stack whether we deploy it
or a user does.

### The streaming model (the mental foundation for every decision below)

Every video is published simultaneously three ways:

1. **HLS playlist + segments** stored in origin storage (L1)
2. **Magnet link** referencing those same HLS files as a WebTorrent
3. **HTTP webseed URL** (BEP-19) embedded in the magnet, pointing back
   at the origin storage

When a client plays a video, WebTorrent fetches pieces **in parallel,
per piece**, from two sources:

- The WebRTC peer swarm (other clients currently seeding)
- The HTTP webseed (our origin storage, served via CDN)

There is no sequential CDN→P2P switchover. Peers are preferred when
they have a piece; the webseed fills any gap. A brand-new video with
zero peers plays entirely from the webseed and looks identical to
pure CDN streaming. As peers accumulate, the P2P offload ratio
increases automatically and origin egress declines — no code changes,
no cache tuning.

This means origin storage must hold the **full catalog**, not a
preview window. Origin egress is bounded above by pure-CDN cost and
below by (1 − P2P offload ratio) × total bytes viewed.

### Decision — four infrastructure layers

**L1 — Origin storage: Cloudflare R2 + Cloudflare CDN.**

All HLS playlists and segments live in R2. Cloudflare's network
(300+ PoPs) fronts R2 with free egress on the CF network. Storage
cost is $0.015/GB/month; egress is zero. R2 is S3-compatible so a
future migration to Bunny Storage, Backblaze B2, or Wasabi is a
config change rather than a rewrite.

The webseed URL in every magnet link points at the R2-backed
Cloudflare endpoint.

**L2 — Seeder compute: Fly.io, starting with one region.**

The standalone seeder service extracted in Phase 0b is packaged as a
Docker image and deployed to Fly.io. Initial deployment is **`lhr`
(London) only** — we start with Europe/UK where early users are, and
expand to `iad`, `fra`, `nrt` once traffic justifies it. Each region
runs one or more seeder instances with a persistent volume for the
local content cache. Content is pulled from R2 on first request and
cached locally on the Fly volume, so we don't duplicate the full
catalog into every region — only what that region's peers actually
ask for.

Fly's anycast routing means WebTorrent peers connect to the nearest
seeder without any client-side routing logic. Cost at initial scale:
roughly $5/month for a single region.

**L3 — Tracker infrastructure: our own WSS trackers, critical path.**

WebTorrent's peer discovery is entirely tracker-based — there is no
traditional DHT, just a WebRTC-over-WSS lookup against a tracker
list. Community trackers (`openwebtorrent.com`, `btorrent.xyz`,
`tracker.webtorrent.dev`) are a soft dependency that can vanish
without warning; when they go down, P2P peer discovery dies and the
app silently degrades to CDN-only streaming. That is a product-level
failure in an app whose value proposition is P2P.

We run our own `bittorrent-tracker` instances on Fly.io in two
regions (`iad`, `fra`) from v1. Client tracker list: our trackers
first, community trackers as fallback. Cost: ~$5/month.

**L4 — Community seeder contribution: Docker image in Phase 0.**

The standalone seeder from L2 is the same Docker image shipped to
users. A self-hosting guide covers: bare Docker, Unraid, Synology
DSM, TrueNAS SCALE, Umbrel, and Start9. Users running on these
platforms are exactly the population most likely to actually
contribute bandwidth, and the self-hosting ecosystems have
established conventions for one-click app installation.

Post-v1: a Tauri desktop app wraps the same seeder for
non-technical users who want to contribute from a laptop. v2: a
contributor-recognition system using the ADR-007 labeler framework
to label seeders by their contribution level.

**Supporting: STUN/TURN relay for WebRTC NAT traversal.**

WebTorrent uses WebRTC data channels for peer-to-peer transfer, which
in turn needs STUN (for candidate discovery) and sometimes TURN (for
relayed traffic when both peers are behind symmetric NATs).
Empirically, roughly 70% of mobile users are behind a NAT that blocks
direct hole-punching, and 15–30% of WebRTC connections fall back to
TURN relay. At 1k DAU this is ~60 GB/month of relayed video bytes —
not free, and not optional.

**Decision.** Self-host `coturn` on a single Fly.io machine alongside
the L3 trackers. Public STUN servers (Google's `stun.l.google.com`)
are fine as the STUN-only fallback. Cost: ~$10/month. Managed
alternatives (Twilio, Xirsys) cost ~$24/month at 1k DAU and scale
linearly; we'll revisit if self-hosted relay becomes an operational
burden.

### Rough cost envelope

| Scale | L1 storage | L1 egress | L2 compute | L3 trackers | TURN relay | Monthly |
|-------|------------|-----------|------------|-------------|------------|---------|
| 1k DAU, 50% P2P offload | ~$1 | $0 | ~$15 | ~$5 | ~$10 | **~$31** |
| 10k DAU, 50% P2P offload | ~$10 | $0 | ~$40 | ~$5 | ~$25 | **~$80** |
| 100k DAU, 60% P2P offload | ~$100 | $0 | ~$200 | ~$15 | ~$150 | **~$465** |

Caveats: (a) assumes P2P offload actually works; degraded fallback
with 0% offload is roughly the same numbers because R2 egress is
free on CF network; (b) the L2 compute line is the biggest guess
because it depends on catalog warmth and cache hit rate.

### Consequences

- **Cost is bounded and predictable** at launch scale. R2's free
  egress is the single most important infrastructure decision for a
  video app; it removes the "viral video deletes the monthly budget"
  failure mode.
- **Geographic diversity comes for free** from Cloudflare's edge
  network (L1) and Fly.io's region set (L2, L3).
- **Community runnability is a v1 deliverable**, not a roadmap
  item. The same software runs on production and on a home server.
- **Vendor lock-in is low**: every layer has a documented
  alternative (Bunny for L1, Hetzner for L2/L3, bare Docker for L4).
- **Fly.io is a conscious reliability bet.** Fly has had publicized
  incidents in 2023-2024 and is "cool" more than "boring." We
  accept this for convenience and reserve the right to migrate L2
  and L3 to Hetzner VPSes if incidents justify it.

### Execution risks

- **WebTorrent on React Native's Hermes runtime.** If
  `react-native-webrtc` doesn't expose a WebRTC surface compatible
  with WebTorrent, P2P offload collapses to zero and we serve every
  byte from R2. Degraded UX + higher compute, but still a viable
  architecture thanks to R2's free egress. Spike in Phase 2.
- **P2P offload ratio in practice.** The 50% offload assumption in
  the cost envelope is a guess. We need real measurements during
  Phase 2 prototyping to validate or revise.
- **R2 reliability.** Cloudflare R2 had several visible incidents in
  2024-2025. It is generally reliable but not perfect. Consider a
  weekly backup to Backblaze B2 (~$5/month) once the catalog grows
  past a few hundred videos.

### Alternatives ruled out

- **AWS S3 / GCS / Azure Blob for L1.** Egress costs dominate
  at video scale. A single viral video can delete a month's budget.
- **Cloudflare Stream / Mux for L1+L2.** Excellent managed video
  services, but they hide the origin, which makes BEP-19 webseed
  fallback impossible. Rules them out for TorTok specifically.
- **Bunny CDN for L1.** Solid competitor; video-specialized features
  like per-video analytics. Starts with per-byte egress costs that
  R2 avoids. Documented as the migration path if R2 causes problems.
- **Hetzner VPSes for L2/L3.** Cheaper (~$15/month all-in) and
  simpler, but no anycast and no one-command multi-region deploy.
  Documented as the fallback if Fly.io causes problems.
- **Cloud Run for L2.** The whole reason we're extracting in Phase 0
  is that Cloud Run is stateless and the seeder needs persistent
  state. Unsuitable.
- **IPFS for content addressing.** Philosophically aligned but adds
  a second P2P protocol to the stack. BitTorrent already works;
  don't diversify in v1.
- **Pure P2P with no origin.** Unacceptable cold-start: new videos
  with no viewers have no peers to seed from.

---

## ADR-009: Phase 2 client seeding scope and policy

**Status:** Accepted — 2026-04-14

**Context.** Phase 2 integrates WebTorrent into the Expo client and
measures P2P offload for the first time. Two things have to be
decided before the spike starts: (a) what platforms the spike has
to work on to count as a pass, and (b) what client seeding
behaviour ships with the prototype. These were listed in
`open-problems/seeding-policy.md` (sub-problem B) and as execution
risks #1 (WebTorrent on Hermes) and #3 (offload ratio) above.

A third related question — what to do if WebTorrent on Hermes
turns out to be unviable — is deferred until we have spike results,
not decided here.

**Decision.**

1. **Spike scope: simulators only.** Phase 2 passes when WebTorrent
   runs in the Expo client on iOS simulator, Android emulator, and
   Expo web, with measurable P2P traffic between two clients in the
   same local swarm. Real-device validation is deferred — simulators
   are sufficient to answer "does WebTorrent run on Hermes and
   produce measurable offload," which is the risk we're buying down.
   Real-device testing moves into the phase where battery and
   carrier-network behaviour actually matter.

2. **Client seeding policy: scroll-back window (policy 2 from
   `seeding-policy.md`), Wi-Fi only on mobile.** The prototype
   seeds the last 5 watched videos for 30 minutes post-view, seeds
   only while the app is in foreground, stops seeding below 30%
   battery, and **does not seed over cellular** — only when the
   device reports a Wi-Fi connection. Desktop/web clients default
   to the more aggressive battery-gated policy 3 described in the
   open-problem file (no network-type gate, since they're assumed
   wired/Wi-Fi).

   The Wi-Fi gate is a preemptive cost control, not a battery
   concession. WebRTC on mobile requires TURN relay for any peer
   behind symmetric NAT, which is common on carrier networks.
   TURN relay bytes cost us money on our coturn box (deployed Phase
   0b); if 20–40% of cellular peers end up relayed, the ADR-008
   "~50% P2P offload" envelope collapses because the swarm's
   "free" bytes become paid relay bytes. Gating seeding to Wi-Fi
   keeps relay load bounded to home-router NAT (mostly cone NAT,
   direct-peer connectable) where it belongs.

   The starting numbers (N=5, M=30, battery=30%) are guesses
   calibrated against the 2024-era libtorrent battery table in
   `seeding-policy.md`. Validate during the spike: if policy 2
   costs more than ~5%/hour in practice, degrade to policy 1
   (on-demand only) and record it as a new ADR.

3. **Fallback if WebTorrent on Hermes fails: defer.** We have
   candidate fallbacks (desktop/web-only P2P with mobile as pure
   consumers; drop P2P entirely and serve all bytes from R2 +
   regional seeders). Neither is cheap to commit to blind. If the
   spike shows Hermes WebRTC is unusable for seeding, we pick a
   fallback then based on measured cost impact, not now based on
   guesses.

**Consequences.**
- Phase 2 has a concrete pass/fail bar: two simulator peers swap
  bytes through WebTorrent on Hermes, offload ratio measured.
- The prototype has a defensible default seeding policy users can
  live with on mobile.
- ADR-008's "~50% P2P offload" cost-envelope number stays
  provisional until Phase 2 produces a measurement; nothing in
  this ADR commits us to hitting that number.
- `open-problems/seeding-policy.md` sub-problem B is now resolved
  — the open-problem file can be trimmed to server-side content
  (or deleted if server-side is also considered resolved).
- The fallback question is left explicitly deferred rather than
  silently ignored; a future ADR picks a direction if the spike
  forces one.

**Alternatives ruled out.**
- **Spike on real devices from the start.** More thorough, but
  doubles the setup cost (test devices, fastlane, USB debugging)
  for a risk (Hermes WebRTC doesn't work at all) that the
  simulator catches just as well. Revisit once simulators are
  green.
- **Policy 1 (on-demand only) as the default.** Lowest battery
  cost but also lowest P2P contribution — would likely invalidate
  ADR-008's offload thesis before we even measure it. Keep as the
  fallback if policy 2 is measurably too expensive.
- **Policy 3 (battery-gated aggressive) on mobile.** Better for
  the swarm, but the 15–25%/hour battery cost in the "seed while
  open" mode will drive users away faster than we can apologise.
  Policy 3 is the desktop/web default, not the mobile default.
- **Allowing mobile seeding over cellular.** Maximises theoretical
  swarm contribution, but symmetric NAT on cellular networks
  forces bidirectional TURN relay. That shifts the bytes from
  "free peer" to "paid coturn," undoing the cost model. Block
  cellular seeding at the client, lift if future measurements
  show carrier-NAT behaviour has changed.
- **Decide the WebTorrent-fails fallback now.** Tempting for
  completeness, but we'd be choosing between two bad options
  without the measurement that tells us which is less bad.
  Deliberate "decide later" is cheaper than a premature ADR we
  then supersede.

**Spike implementation notes (Hermes + web quirks, 2026-04-14).**
All three simulator targets (iOS, Android emulator, Expo web in
headless Chrome) are now green: peers handshake over WebRTC
datachannels and exchange BitTorrent protocol traffic end to end.
On iOS and Android the spike measured `Downloaded > 0` against the
local seeder; on web the same magnet reaches the seeder, completes
the metadata exchange, and the browser uploads ~200 KB of bitfield
/ wire-protocol traffic to the four other peers (seeder + 2 iOS +
Android). The web client doesn't pull file pieces because no
consumer (`torrent.files[0].appendTo()` etc.) is wired up in the
spike — that's a feed-integration concern, not a transport-layer
one. Getting there surfaced eight Hermes compat gaps and three
additional web-only ones. They are not architectural decisions —
they live here rather than in a README because anyone re-deriving
the stack (future RN upgrade, new engine, web framework swap) will
hit the same list.

Runtime globals — `tortok/lib/webtorrent/polyfills.native.ts`
on Hermes, `polyfills.web.ts` on web (Metro picks the platform
extension automatically):

1. **`globalThis.crypto` with `getRandomValues`.** `uint8-util`
   reads `self.crypto.getRandomValues` at module-init time; Hermes
   has no `crypto` global. Install `react-native-quick-crypto` as
   `globalThis.crypto` before any webtorrent code runs. Metro's
   `crypto`→quick-crypto alias does **not** cover this — the alias
   only rewrites `import/require 'crypto'`, not dynamic reads off
   the global scope.
2. **`process.browser = true`.** `bittorrent-discovery` and
   `bittorrent-tracker` branch on `process.browser` to skip
   Node-only code paths (binding TCP ports, etc.). Hermes isn't a
   browser but behaviourally matches one — no TCP/UDP sockets
   available — so set it truthy.
3. **RTC globals on `globalThis`.** `webrtc-polyfill`'s browser
   entry reads `RTCPeerConnection`, `RTCSessionDescription`,
   `RTCIceCandidate`, `MediaStream`, `MediaStreamTrack`,
   `RTCRtpReceiver`, `RTCRtpSender` off the global scope. Populate
   them from `react-native-webrtc` before webtorrent loads.

Module-resolution — `tortok/metro.config.js`:

4. **Node-core shims via `extraNodeModules`.** crypto →
   react-native-quick-crypto, stream → readable-stream, rest
   (buffer, events, process, path, util, url, os, querystring,
   assert) → their respective browserify packages. net, dns, tls,
   fs, http, https are stubbed to an empty module since the
   WebRTC-only transport never hits them on mobile.
5. **`unstable_enablePackageExports` + `unstable_conditionNames =
   ['require', 'browser']`.** Forces Metro to pick `webrtc-polyfill`'s
   `browser` conditional-export entry, which reads globals from
   globalThis, instead of its Node entry which imports
   `node:stream`.

ESM/CJS interop — `tortok/app/spike.tsx` (and any future
consumer):

6. **Unwrap `require('webtorrent').default`.** webtorrent is
   `"type": "module"` with `export default class WebTorrent`. Metro's
   ESM→CJS interop returns `{ default: WebTorrent, __esModule: true }`,
   so `require('webtorrent')` is not callable as a constructor.

WebCrypto / WebRTC shim patches — in `polyfills.ts`:

7. **`RTCPeerConnection.prototype.getStats` arity patch.**
   `@thaunknown/simple-peer` branches on `pc.getStats.length` to
   choose Promise vs. callback style. `react-native-webrtc`
   declares `getStats(selector?)` — arity 1 — so simple-peer takes
   the callback branch and passes its callback as the `selector`
   argument, producing "Invalid selector: could not find matching
   sender / receiver" on every stats poll. Wrap the prototype to
   arity 0; the inner call still passes no selector and returns
   the full Map.
8. **Case-insensitive `subtle.digest`.** QuickCrypto's SubtleCrypto
   does **strict uppercase** matching against `SUPPORTED_ALGORITHMS`
   (`'SHA-1'`), but `uint8-util.hash` and `bittorrent-protocol`
   pass `'sha-1'` lowercase. BitTorrent piece hashing fails with
   `NotSupportedError: Unrecognized algorithm name: sha-1` the
   moment the first piece arrives. Wrap `digest` to uppercase the
   algorithm name before delegating (the WebCrypto spec explicitly
   says algorithm names are case-insensitive — this is a QuickCrypto
   spec-compliance gap we compensate for, not a webtorrent bug).

Web-only quirks (resolved 2026-04-14):

9. **Pin `webrtc-polyfill` to its `browser.js` entry on every
   platform via `resolveRequest`.** Its conditional-export `node`
   entry pulls in `lib/Blob.js`, which uses top-level await. The
   Expo static-renderer SSG path runs Node-target bundling whose
   minifier (SWC) cannot parse TLA, so SSG bundling fails before
   it ever reaches our lazy `import()`. The browser entry is a
   thin shim that just reads `RTCPeerConnection` etc. off
   `globalThis` — exactly what we want, since the polyfill module
   populates them on Hermes and the browser already has them.
10. **Per-platform `crypto` resolution.** `extraNodeModules.crypto =
    react-native-quick-crypto` is the right answer on Hermes but
    blows up on web because rn-quick-crypto pulls in JSI bindings
    that don't exist there. Move the alias into `resolveRequest`
    and only apply it when `platform !== 'web'`. On web, webtorrent's
    own `"crypto": false` browser-field stub now wins, and uint8-util
    reads the browser's native `crypto` global.
11. **Inject a `process` shim into `globalThis` *before* the bundle
    script tag executes — `app/+html.tsx`.** Metro's web bundle
    preamble does `var process = globalThis.process || {}`, which
    captures the empty object at script-load time. Modules like
    `end-of-stream` then read bare `process.nextTick` from that
    captured local, so installing `globalThis.process` later from
    `polyfills.web.ts` is too late — the local var has already
    snapshotted. The Expo Router custom-HTML hook
    (`app/+html.tsx`) lets us stick a tiny inline `<script>` in
    `<head>` that populates `globalThis.process` (with a real
    `nextTick`, an `env`, `browser=true`, etc.) before the entry
    bundle ever runs. On Hermes this isn't needed because the RN
    runtime supplies a `process` global before the bundle loads.

Polyfill split: `polyfills.native.ts` carries the full Hermes
compat layer (rn-webrtc imports, getStats arity patch, subtle.digest
case wrapper, QuickCrypto install, Buffer/process/nextTick install).
`polyfills.web.ts` is a much smaller shim that just installs Buffer
and re-asserts `process.browser = true` — browsers ship native
crypto, RTCPeerConnection, etc., so the heavy lifting falls away.
Metro picks the right file via its platform-extension resolution
(`.native.ts` / `.web.ts`); TypeScript needs a `polyfills.d.ts`
declaration to see the platform-less import path.

The simulator-only pass/fail from decision (1) above is the bar
being chased here, not real-device support. When Phase 2 extends
to real iOS/Android hardware, expect another round of quirks (most
likely around TURN credentials, NetInfo-driven Wi-Fi gating, and
NAT traversal across cellular networks — neither simulators nor
the local-network emulator setup exercise those paths).

**Deferred optimizations (identified during Unit 2 integration,
2026-04-17).**

The production integration confirmed that P2P playback works
end-to-end on iOS simulator: WebTorrent init → tracker → WebRTC
handshake → TcpSocket HTTP bridge → expo-video plays via bridge URL.
HLS fallback also works cleanly when P2P takes too long. Three
optimizations are deferred until after three-platform validation:

1. **Inline .torrent metadata.** Magnet-only resolution takes ~6s
   because WebTorrent must do a WebRTC handshake just to fetch the
   torrent info dict from the seeder. Serving the .torrent file
   (or its info dict as base64) in the feed API response would let
   `client.add(torrentBuffer)` resolve instantly — no tracker or
   peer connection needed for metadata. Requires: `torrent_file_url`
   column in the DB, .torrent files hosted on R2/CDN, client fetches
   the buffer and passes it to `client.add()`.

2. **Wider pre-fetch window.** Currently `useP2PUrl` fires for
   `isActive || isAdjacent` (±1 video). With instant metadata
   resolution, widen torrent pre-resolution to ±2 or ±3 while
   keeping player creation at ±1. Adjacent torrents resolve before
   the user scrolls to them — the `managed` map fast path returns
   the cached bridge URL immediately.

3. ~~**P2P-primary source selection.**~~ Implemented and then
   superseded — see amendment below.

Combined effect: first video in a session may start via HLS (cold
torrent), but every subsequent scroll uses a pre-resolved P2P bridge
URL with zero delay. The HLS fallback becomes a rare cold-start
path rather than the default.

**Amendment (2026-04-19): Drop HLS, webseed-only.**

Optimizations #1 and #3 are now implemented. With inline .torrent
metadata resolving in <1s, the 3-second HLS fallback timer fires
rarely. More importantly, HLS viewers are "leeches" — the native
player fetches segments directly from R2 via its own HTTP stack,
bypassing the WebTorrent swarm entirely. Those bytes are never
re-shared to peers.

Webseed (BEP-19) solves this: the torrent metadata includes an
`urlList` pointing at the raw MP4 on R2. When no peers are
available, WebTorrent fetches pieces from that HTTP origin — but
downloaded pieces are re-shared to the swarm like any other peer
data. Every viewer participates in P2P regardless of how they got
their first bytes.

Changes:
- `hlsURL` removed from Video type, API responses, and validation
- `hls_url` DB column kept nullable (vestigial, no migration needed)
- `lockedUrl` state and `P2P_TIMEOUT_MS` timer removed from client
- `urlList` added to torrent creation in both production seeder and
  test-content seeder
- Source selection simplified: `videoUrl = p2pUrl` directly

Requires raw MP4 uploaded to R2 at the webseed URL. The existing
HLS segments in R2 remain for the standalone seeder service (which
downloads them for its own torrent seeding).

---

## ADR-010: Bridge Bluesky video posts into the tortok feed (inbound federation)

**Status:** Accepted — 2026-04-17

**Context.** The chicken-and-egg problem at launch is severe: a new
short-form video app shipping with an empty feed dies on day one.
The release research informing `docs/release-plan.md` is unambiguous
— TikTok solved the empty feed with the For You Page, Instagram by
hand-curating supply, Bluesky (badly, late) with Starter Packs. None
survived showing a new user a blank follow feed. We have no ad
budget for the TikTok approach and no team to scale the Instagram
approach beyond its absolute Halo tier.

ADR-002 commits us to AT Protocol. Bluesky added native video posts
in late 2024 (`app.bsky.embed.video`), and they federate over the
standard atproto firehose like every other record. The data is open
by design.

The current ADR-006 phase plan defers all federation work to Phase 3
(PDS standoff). That ordering is correct for the *outbound* direction
— publishing signed `tortok.video.post` records requires our own PDS.
But the *inbound* direction — consuming and rendering existing
Bluesky video posts in the tortok feed — needs none of that
infrastructure. It can run as a read-only firehose subscriber,
parallel to the Phase 2 P2P client work, with no dependencies on
Phases 3–4.

This ADR pulls inbound federation forward and treats it as the
cold-start solution for the open beta launch.

**Decision.**

1. **Subscribe to the atproto firehose, filter for video posts.** Use
   `@atproto/sync` against a public relay to consume `com.atproto.sync.subscribeRepos`,
   filter commits for `app.bsky.feed.post` records whose embed is
   `app.bsky.embed.video`, and index matched records in Postgres
   alongside the existing video schema.

2. **Render bridged posts in the tortok vertical feed alongside
   native `tortok.video.post` content.** Bridged posts are
   first-class feed items, not segregated into a separate "explore
   Bluesky" tab. The federation pitch — "same network, different
   lens" — only works if the experience is genuinely unified.

3. **Display-only in v1. Engagement stays on Bluesky.** Bridged
   posts surface a "via Bluesky" affordance and a one-tap link back
   to the original post. Likes, replies, and follows on bridged
   content are Bluesky-side actions; we do not mirror or proxy them.
   This keeps the trust model simple (we are a renderer, not an
   actor) and avoids duplicating Bluesky's social graph.

4. **Bytes come from Bluesky's video CDN.** v1 does not re-host
   bridged content on tortok seeders. The P2P story (ADR-008) does
   not apply to bridged content — it is the lure, not the conversion.
   Bandwidth for bridged content is Bluesky's cost, not ours.

5. **Honor opt-out signals.** Creators who do not want their posts
   bridged can opt out via the same self-labeling conventions used
   by existing atproto bridges (e.g., the Bridgy Fed `!no-bridge`
   pattern). The bridge filters out posts from authors carrying
   these labels at index time. Revisit label semantics if atproto
   formalizes a bridging-consent convention later.

6. **Inherit moderation via labelers.** Subscribe to the same default
   labeler set Bluesky's first-party app uses, plus any labelers we
   adopt for our own moderation policy (separate from this ADR;
   tracked in `open-problems/moderation.md`). Bridged posts carry
   their labels into the tortok client and are filtered/hidden
   according to user moderation preferences.

7. **Native upgrade path is the conversion funnel.** Once Phase 3's
   PDS is live, bridged posts include a creator-facing affordance
   ("post natively to tortok for P2P-backed durability and
   portability") that lands them in the native posting flow. Until
   then, the affordance is a "notify when available" capture.

8. **Phase placement.** This work runs as a parallel track alongside
   Phase 2 P2P client work. Neither blocks the other. The bridge
   must be live before the open beta launch in `docs/release-plan.md`
   Phase A. Treat it as a Phase 2.5 milestone if linearity matters.

**Consequences.**

- The empty-feed problem is solved on day one of open beta. A new
  user opens tortok and sees real video from real creators, possibly
  including accounts they already follow on Bluesky.
- The federation thesis becomes provable, not asserted. "Your
  followers come with you" is demonstrated by the *content* coming
  with you, not just claimed on a marketing page.
- Creator-outreach economics shift. We are not asking creators to
  *move* — we are showing them their content already plays in tortok,
  and the ask becomes "post natively when you want the durability
  upgrade." Smaller commitment, higher expected conversion.
- We become a downstream consumer of the Bluesky firehose. Bluesky
  PBC could throttle, block, or change firehose access policies.
  Mitigation: multiple public relays exist; document a fallback list
  and confirm we can switch with config, not code.
- Bandwidth asymmetry. v1 ships Bluesky's bytes through our app
  without contributing to their costs. This is protocol-allowed
  behaviour — the firehose and video CDN are public — but it is
  worth being honest about. If bridged consumption at scale becomes
  a point of friction, we can offer to mirror bridged content to our
  seeders (with creator consent) and contribute upload bandwidth
  back into the swarm.
- Moderation surface area grows. We are now responsible for filtering
  bridged content according to our own policy *plus* inheriting
  Bluesky's labeler signals. The default labeler subscription set
  becomes a launch-blocking decision, partially covered by
  `open-problems/moderation.md` but raised in urgency by this ADR.
- Opt-out must work flawlessly from launch. Creators who self-label
  as no-bridge and find their content bridged anyway is the kind of
  trust failure that lights up Bluesky within hours. Opt-out
  correctness is a launch criterion, not a polish item.
- ADR-006's Phase 3 ordering is unaffected for *outbound* federation
  (publishing signed `tortok.video.post` records still requires the
  PDS). Inbound is decoupled from that timeline. ADR-005's AppView
  effectively starts here in pull-only mode — Phase 3/4 work then
  extends it to subscribe to our own PDS as well.

**Alternatives ruled out.**

- **Wait for Phase 3 to do all federation work together.** Cleaner
  conceptually but leaves the cold-start problem unsolved during the
  open beta window. The launch dies and Phase 3 ships into a
  graveyard.
- **Scrape TikTok / Instagram and rehost.** Legally hostile,
  creator-hostile, contradicts the wedge. Ruled out in release-plan
  discussion regardless of ADR-010.
- **Show bridged content in a separate "explore Bluesky" tab.**
  Defeats the federation pitch. The whole point is that the network
  is shared — segregating bridged content into a side surface
  implies it's a different network.
- **Bridge bytes as well as records — auto-mirror Bluesky video to
  tortok seeders.** Higher contribution back to the open web, but
  consent-fraught (republishing Bluesky's CDN bytes via P2P is a
  different act from rendering them). v2 feature, gated on creator
  opt-in, not v1.
- **Bridge engagement (likes, replies) bidirectionally.** Doubles
  the trust model, requires write authority on Bluesky (which we
  don't have without per-user OAuth), and risks fragmenting
  conversation. Display-only is the right v1 scope.
- **Build our own atproto relay.** Saves us from depending on
  Bluesky/third-party relays but is significant infrastructure for
  a v1 feature. Subscribe to existing relays; reconsider if any
  prove unreliable or hostile.

**Implementation notes.**

- Add a `source` column on the video records table to distinguish
  `native` vs `bridged_bluesky`. Bridged records carry the
  originating DID, post URI, and CDN URL; they do not carry a
  magnet URI.
- The player must handle both magnet-URI playback (native) and
  direct HLS playback from Bluesky CDN (bridged) without UI
  difference.
- Firehose subscription is a long-lived process — fits in the
  AppView service plan from ADR-005, started early in pull-only
  mode here.
- Cost: one persistent WebSocket plus a small Postgres write rate.
  Negligible at v1 scale; revisit if the index outgrows the existing
  Postgres instance.
- Opt-out test: include at least one no-bridge-labeled author in
  CI fixtures. The bridge must filter them out at index time, not
  just at render time.

---

## ADR-011: Monetization architecture — interface-first payout, first-party pool committed, V1 rail gated on Apple + US-incorporation prerequisites

**Status:** Accepted — 2026-04-17

**Context.** The release-plan discussion forced the monetization
question earlier than expected. The public wedge settled as "your
videos, your followers, yours to take anywhere" — creator-and-
audience-in-control. That framing forecloses platform-extractive
monetization (no ad-rev share, no take of creator payments, no
platform-controlled distribution) and sharpens the "what's the
*positive* fan-facing monetization story?" question.

The answer that emerged: a **pay-what-you-think-it's-worth monthly
"support open content" subscription**, where fans pool contributions
and manually allocate their pool across the creators they follow —
fan-side curation rather than platform-side or formula-side
distribution. This is the missing product in the creator economy:
Patreon doesn't scale for fans (nobody runs 50 × $5/mo
subscriptions), but a single $20/mo pool split across 5–10 creators
does. It is directly aligned with the wedge ("you control where the
money goes").

The existing principle in `open-problems/monetization.md` — "TorTok
does not operate the pool, TorTok does not custody creator money" —
contradicts a first-party pool. The contradiction is genuine and
needs resolving here.

Two oracle research passes explored operating mechanisms:

1. **Open Collective / fiscal host.** Surfaced serious blockers:
   distribution is not automated (expense-per-payout with host
   approval), policy fit is hostile (OSC rejects non-code, OCF
   dissolving, SCN UK-only), and the "click to create your own
   pool" pattern is fundamentally incompatible with how fiscal hosts
   operate.
2. **Stripe + USDC-on-Base (Stablecoin Payouts for Connect).**
   Product exists (private preview). Creators onboard via Stripe
   Connect Express (KYC required), payouts go to creator-controlled
   Base wallet addresses. Effective fee ~7.4%. Platform (tortok) must
   be US-incorporated. Apple App Store Guideline 3.1.1 is a real risk
   for in-app flows. Chargeback asymmetry requires operational
   policy.

Neither rail is a drop-in answer. The design question becomes: how
do we commit to the product without committing to a rail that isn't
fully knowable yet?

**Decision.**

1. **Architect payout behind an interface, not a rail.** The stable
   primitive is Sub-problem A's `tortok.payout.destination` Lexicon
   (creator-owned, multiple destination kinds: Patreon URL, LN
   address, Base wallet, Stripe Connect link, generic URL). Which
   backend routes money for a given pool is a per-pool
   implementation detail. This means no rail decision is load-
   bearing on the Lexicon or the UX; rails can be added, swapped,
   or run in parallel without schema changes.

2. **Commit to the first-party "support open content" pool as a
   product surface.** TorTok publishes it, brands it, onboards fans
   into it. This contradicts the earlier "TorTok does not operate
   the pool" principle. That principle is **softened, not
   abandoned**: TorTok may operate a pool and briefly custody fan
   funds in transit (e.g., in a Stripe balance between collection
   and batched distribution), but TorTok does not hold a permanent
   balance representing creator earnings, and does not take a
   revenue cut. The amended principle is: **"TorTok does not profit
   from custody of creator money."**

3. **Fan-allocated distribution is the default mechanic.** Each fan
   manually allocates their monthly pool across the creators they
   follow/choose. Fallback when unallocated: split across recently-
   watched follows (exact rule deferred to implementation). This
   sidesteps the view-count trust problem — `view-counting.md` is
   *not* a prerequisite for this pool mechanism, which loosens the
   sequencing on this ADR.

4. **Leading V1 rail candidate is Stripe + USDC-on-Base,** with
   explicit acceptance of: creator KYC via Stripe Connect Express
   (decided 2026-04-17 to be acceptable V1 friction — identical to
   Patreon/YouTube, does not compromise the wedge), transient fiat
   custody in Stripe balance, and a documented chargeback policy.
   Rail commitment is *not final here* — it is gated on the two
   prerequisites below.

5. **Prerequisite P1 (Apple App Store).** Obtain a written Apple
   position on Guideline 3.1.1 for a fan-allocated PWYW pool that
   distributes to third-party creators. Three possible outcomes:
   (a) Apple confirms the flow is not IAP → ship in native iOS app;
   (b) Apple requires IAP → pool is web-only on iOS for V1;
   (c) Ambiguous → default to web-only to avoid review roulette.
   The pool launching web-only is compatible with the PWA-first
   shape of Phase A in `docs/release-plan.md` — iOS users tap out to
   a browser flow to subscribe and allocate. This is friction but
   not a blocker.

6. **Prerequisite P2 (US incorporation).** Decide whether tortok
   incorporates in the US. This is a company decision with
   implications beyond monetization (tax residency, legal exposure,
   App Store entity requirements). Stripe+USDC requires it;
   Lightning doesn't. The decision is deferred to its own
   discussion; this ADR only notes that the leading V1 rail depends
   on it.

7. **Lightning is a parallel optional rail, not the V1 primary.**
   Creators who publish a Lightning address destination (Sub-problem
   A) can receive Lightning tips and, in a later V2, Lightning-based
   pool distributions. Lightning runs alongside the V1 fiat rail,
   not instead of it. Strike or Alby are the candidate custodial
   services; final pick deferred.

8. **"Click to create your own pool" (Sub-problem B) is V2, not
   V1.** Neither researched rail supports it cleanly — Stripe
   Connect per pool requires platform-level onboarding per pool;
   fiscal hosts require per-project approval. The general
   `tortok.payout.pool` Lexicon ships when there is a rail that
   supports per-pool instantiation without heavy platform friction.
   For V1, the first-party pool is the only first-party-surfaced
   pool; third parties can still self-host pools and publish the
   Lexicon records once the Lexicon lands, but tortok does not
   surface or endorse them in the client.

9. **Open Collective is deprioritized.** Automation incompatibility,
   platform risk (OCF precedent, host dissolution), and policy-fit
   hostility make it a worse fit than Stripe+USDC even before the
   "click to create your own pool" mismatch. Not ruled out forever
   — a favorable fiscal-host relationship or a change in OC's
   expense primitives could reopen it — but not a V1 path.

10. **Tipping (one-off) ships as a parallel mechanism,** not a
    replacement for the pool. Per-creator destinations (Sub-problem
    A) already support it. Tips on Lightning addresses require no
    tortok custody; tips through the Stripe rail route through the
    same pool infrastructure with a different distribution formula
    (1:1 to the tipped creator).

11. **Sequencing.** Sub-problem A (the `tortok.payout.destination`
    Lexicon) ships first and is not rail-dependent — creators can
    publish Patreon / Substack / LN / URL destinations on day one
    of Phase 3. The first-party pool ships after both prerequisites
    resolve and the chosen rail is wired up. Sub-problem B ships
    whenever V2 rail availability makes it cheap.

**Consequences.**

- The "TorTok does not custody creator money" principle is amended
  to "TorTok does not profit from custody of creator money." This
  is a softening; record it clearly so it is not silently drifted.
- Monetization is unblocked as a product decision without being
  locked to a rail. The `tortok.payout.destination` Lexicon can
  land in Phase 3 alongside the PDS work with no rail commitment.
- The release-plan Phase C ("App Store/Play 1.0 promotion, triggered
  by readiness or catalyst") acquires a hard dependency on
  Prerequisite P1. A native pool flow cannot ship on iOS without
  Apple's position. If Apple forces web-only, the App Store launch
  is still possible — the pool simply lives in the PWA surface.
- Creator KYC becomes a documented V1 requirement for the first-
  party pool. Creators who want to receive from the pool complete
  Stripe Connect Express onboarding (identity + tax). Earlier drafts
  framed this as wedge-breaking; this ADR records that it is not —
  it is identical friction to Patreon/YouTube, does not compromise
  the "yours to take anywhere" wedge, and nothing prevents a later
  non-KYC rail from being added in parallel.
- TorTok becomes a US entity candidate. Prerequisite P2 is elevated
  from "at some point" to "before V1 pool launch." If we decide
  against US incorporation, the V1 rail shifts to Lightning (which
  has its own much-narrower audience) or another fiat rail yet to
  be surveyed.
- Chargeback policy becomes a pre-launch operational item. When a
  fan chargebacks after USDC has been distributed, the default is
  tortok absorbs the loss (covered from a small operational reserve
  taken from *somewhere* — TBD, not from creator distributions).
- The moderation surface grows. A first-party pool that pays
  creators creates a stronger "tortok endorses these creators by
  paying them" signal than a neutral hosting platform creates, even
  if the distribution is fan-allocated. This increases pressure on
  `open-problems/moderation.md` but does not block this ADR.
- Sub-problem B ("click to create your own pool") being V2 softens
  the federation pitch slightly — third parties can still run pools
  via the Lexicon, but tortok won't surface them. Revisit when the
  rail situation allows.

**Alternatives ruled out.**

- **Pick a rail now and write the ADR around it.** Tempting but
  premature: neither researched rail is fully knowable without
  Apple's position (P1) and the US-incorporation decision (P2).
  Writing the ADR around Stripe+USDC today forces commitment to
  P1 and P2 outcomes that haven't been obtained. Interface-first
  lets the product commitment land while rail commitment waits.
- **Fiscal host (Open Collective) as V1.** Ruled out by research
  findings — distribution automation incompatibility and platform
  risk are structural, not polish issues.
- **Lightning as V1 primary.** Too-narrow audience (Lightning-
  literate creators and fans only). Runs as parallel optional
  rail, not primary.
- **Patreon-for-tortok (tortok holds a Patreon, pays creators out
  of it).** Ruled out by the custody principle — tortok would hold
  a permanent balance of creator earnings, which the amended
  principle explicitly rejects.
- **Smart contract on-chain pool (Ethereum / Solana).** Non-
  custodial for tortok but forces crypto UX on every fan.
  Contradicts ADR-007's "frictionless familiar signup."
- **Abandon the first-party pool and keep only the general
  primitive.** Possible but the release-plan discussion settled
  that the first-party pool is the product-market-fit answer to
  "what's the positive fan monetization story?" Punting it leaves
  that story unanswered through Phase A and B.
- **Take a platform revenue cut.** Ruled out by wedge alignment.
  Tortok's position is creator-and-audience-in-control; a platform
  cut contradicts the story we're telling. Revisit only if
  operational costs demand it, and as a separate explicit decision.

**Implementation notes.**

- `tortok.payout.destination` Lexicon design work: Phase 3,
  independent of rail decision.
- First-party pool UX design: Phase B of `docs/release-plan.md` or
  later, gated on P1 + P2 + rail commitment.
- Chargeback operational reserve: size and funding source TBD.
  Not from creator distributions.
- Stripe Connect private-preview application: submit before
  committing to the rail, as the product may not be generally
  available when we need it.
- Apple engagement (P1): written position via App Store Review /
  DR channel, not forum posts or precedent-hunting. This is the
  only kind of answer that holds under review.

---

## Unresolved design problems

Real design problems with candidate approaches live in
`docs/architecture/open-problems/`. Each file has a `Must resolve by:`
header stating the phase that forces the decision.

- **`moderation.md`** — resolve by Phase 3, before signup opens to
  anyone outside the team. (Even though auth now lives at the user's
  PDS, content moderation is still our job at the AppView layer.)
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

- **Lexicon namespace governance.** Declare `tortok.*` publicly in
  our repo and document our schema; follow any formal atproto
  governance that lands later. Before Phase 3.
- **AppView + PDS running cost estimate.** Indexing, repo event
  subscription, feed generation, and PDS blob storage all cost real
  money on top of the ADR-008 envelope. Back-of-envelope before
  Phase 3; detailed before Phase 4.
- **AppView firehose scale / subscription filtering.** A naive
  subscriber to the full Bluesky firehose drowns. Subscribe only to a
  TorTok-specific relay (nobody is running one yet) or filter
  aggressively at ingest. Phase 4.
- **PDS fork scope.** How much of `bluesky-social/atproto`'s reference
  PDS do we keep? The `app.bsky.*` lexicons aren't relevant but
  ripping them out may be more work than leaving them as unused
  endpoints. Err on "leave it alone unless it's hurting anything."
  Phase 3 during the fork.
- **Custodial rotation key storage.** Google Secret Manager, AWS KMS,
  HashiCorp Vault, or a dedicated Postgres table with column-level
  encryption? Most sensitive material in the stack. Phase 3 before
  the PDS handles its first real user.
- **Self-custody upgrade path.** UX flow for a user moving from
  custodial to user-held rotation keys without breaking their account.
  The atproto mechanism supports it; the flow (generate on device,
  prove possession, server hands over authority, update PLC op) needs
  designing. Not blocking v1; worth prototyping before we promise it.
- **Existing user migration.** If Phase 1 ships before Phase 3, users
  who sign up during that window exist only in the legacy backend.
  Phase 3 has to mint DIDs for them and rewire their accounts.
  One-shot backfill, not ongoing dual-write. Design during Phase 3.
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
