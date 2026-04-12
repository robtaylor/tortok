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

**Status:** Accepted

**Context.** AT Protocol accounts are DIDs. Two methods are practical:
`did:plc` (PLC directory, currently operated by Bluesky PBC) and `did:web`
(DNS-based, self-sovereign). `did:key` is unsuitable because AT Protocol
assumes keys can rotate.

**Decision.**
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
  cross-platform API). Users who upgrade gain the ability to migrate
  to another PDS without our cooperation.
- **Post-v1: `did:web` for sovereigns.** Power users who own a domain
  can opt into `did:web` as part of the self-custody upgrade. We
  document the DNS configuration; we do not host identity documents
  for them.

**Consequences.**
- v1 users get a familiar, frictionless signup flow. No seed phrases,
  no key exports, no "write this down" dialogs.
- v1 is explicitly not self-sovereign. A user who loses their password
  can recover via email; a user who wants to migrate off TorTok cannot
  do so without our cooperation until they opt into self-custody. We
  document this limitation honestly rather than hiding it.
- Once a user upgrades to self-custody, the full atproto
  account-portability win kicks in — they can migrate PDS without
  losing handle, followers, or history. This is the payoff that makes
  the protocol choice worth it in the first place.
- `did:plc` depends on PLC directory availability. We should monitor
  proposals to decentralize PLC and follow the consensus migration
  path if one emerges.

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

Step 1 is deploying the current backend monolith (Express + embedded
seeder) to Fly.io as-is, replacing the Cloud Run deployment. This
proves the deploy pipeline, gets secrets on Fly, and gives us a
working production target before we start splitting services. The
seeder extraction happens as a follow-up once the monolith is
healthy on Fly.

- Deploy the backend monolith to Fly.io `lhr` (London). Expand to
  additional regions once traffic justifies it.
- Server-side seeding policy: **demand-pull caching only** at
  launch. Pre-warming strategies (most-views, trending,
  recently-added) are documented for later — see
  `open-problems/seeding-policy.md`.
- Extract the WebTorrent seeder from the Express process into a
  standalone Node/TypeScript service. Package as a Docker image with
  sensible defaults. The same image runs on our production
  infrastructure and on a user's home server — this is L4 of
  ADR-008.
- Stand up our own `bittorrent-tracker` instances on Fly.io per L3
  of ADR-008. Update the client's tracker list to prefer our
  trackers, with the community trackers as fallback.
- Migrate the existing seed content from `backend/content/` to
  Cloudflare R2 per L1 of ADR-008. The backend's `express.static`
  route for `/content` is removed; URLs now point at R2.
- Publish the Docker image and a self-hosting guide (Docker, Unraid,
  Synology, TrueNAS, Umbrel) so users can contribute to the swarm.

**Phase 1 — Expo skeleton.**
- Scaffold the Expo project. Pick a navigation approach (Expo Router) and
  a state approach (React Query + Zustand or similar).
- Reimplement login against the existing backend API (not atproto yet).
  This proves the auth flow and lets us throw away `AuthManager.swift`
  mentally even if we don't delete it yet.
- Implement a basic vertical feed with `expo-video` or `react-native-video`.
  Target: visual parity with the current Swift feed, no P2P yet.

**Phase 2 — Cross-platform P2P.**
- Integrate WebTorrent in the Expo client. This requires verifying that
  WebRTC works in the chosen JS engine (Hermes may need polyfills; see
  open questions below).
- Replace HLS-only playback with P2P-backed streaming, falling back to
  HTTP webseeds when the swarm is cold.
- Confirm iOS, Android, and web all play the same video.
- At this point we have a working cross-platform TorTok with no federation.
  Shippable as an alpha.

**Phase 3 — Stand up our own PDS and wire the client to it.**
- Fork `bluesky-social/atproto`'s reference PDS implementation. Strip
  Bluesky-specific lexicons; keep the core auth, blob, and repo
  surface. Deploy it alongside the existing backend.
- Implement the `tortok.video.post` Lexicon and register it.
- Replace the legacy email/password backend with our PDS as the auth
  source. Signup flow becomes email + password + Turnstile (see
  ADR-007). Migrate existing users by creating did:plc identities for
  them on the PDS and mapping old user IDs to new DIDs.
- Add `@atproto/api` to the client. Publish a video as a signed
  `tortok.video.post` record (create magnet, upload thumbnail as blob,
  create record). The old video-post endpoint is retired in this phase.

**Phase 4 — AppView cutover.**
- Stand up the AppView as a separate service. It subscribes to our
  own PDS's repo event stream, filters for `tortok.video.post` records,
  indexes them in Postgres, and serves feed endpoints.
- Client feed endpoint switches from the legacy feed API to the
  AppView. The legacy feed endpoint is retired.
- At this point the backend is three services: PDS, AppView, seeder
  worker. Each has a clear job.

**Phase 5 — Retire Swift.**
- Archive the Swift codebase. Any remaining consumers migrate.

---

## ADR-007: Signup UX and spam prevention

**Status:** Accepted

**Context.** Earlier drafts of ADR-005 assumed users would bring their
own atproto identity from an existing PDS (typically bsky.social) and
log in via atproto OAuth. Research confirmed Bluesky themselves dropped
SMS verification in February 2024 in favour of CAPTCHA-only signup,
and exposing Bluesky at the user level is explicitly not what we want
for TorTok — we want a clean, familiar, branded experience where
atproto is backend plumbing the user never sees. This ADR defines the
signup flow and the spam-prevention strategy that sits in front of it.

**Decision.**

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

## Unresolved design problems

Real design problems with candidate approaches live in
`docs/architecture/open-problems/`. Each file has a `Must resolve by:`
header stating the phase that forces the decision.

- **`moderation.md`** — resolve by Phase 3, before our PDS opens
  signup to anyone outside the team.
- **`view-counting.md`** — resolve by Phase 4 AppView cutover, or
  earlier if feed ranking uses view counts. Under the external
  monetization model (see `monetization.md`) this becomes the single
  most important signal TorTok provides to creators.
- **`seeding-policy.md`** — server side by Phase 0b (the seeder
  container has to pick a caching behavior), client side by Phase 2
  (when the Expo client actually seeds).
- **`monetization.md`** — philosophy is decided (TorTok provides
  signals, not money movement); sub-problems around payout-destination
  lexicons and optional federated pools are the open parts. Resolve
  before announcing any pool→payout support.

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
- **Direct platform monetization.** TorTok does not serve ads, host
  paid content, or pay creators directly. Creators monetize externally
  (Patreon, host-read sponsorships, direct deals) using trustworthy
  engagement signals published by our PDS. See
  `docs/architecture/open-problems/monetization.md` for the full
  framing and the sub-problems that remain open.
- **Self-hosted PDS tooling.** Deferred to post-v1 per ADR-005.
- **Payment processing / KYC / creator payouts.** Out of scope
  because of the external-monetization choice above.
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
