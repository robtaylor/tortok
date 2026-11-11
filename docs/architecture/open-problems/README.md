# Open problems — tortok extension

This directory is a **tortok-specific extension** to the stock Claude Project
Discipline. The stock discipline has five kinds (architecture reference,
decision, spike, plan, handoff) and no first-class home for *"a decision we have
deliberately not made yet, forced by a known future phase."* tortok's
phase-gated development (see the phases table in [`CLAUDE.md`](../../../CLAUDE.md))
leans on exactly that, so we keep it.

Each file here is a real design problem with candidate approaches and a
**`Must resolve by:`** header naming the phase that forces the decision. When one
resolves, it becomes a [decision record](../decisions/README.md) and the file is
deleted (the decision is the permanent home; this file is scaffolding). This
index also tracks deferred decisions and explicit out-of-scope items that are
lighter than a full open-problem file.

> **Upstream follow-up:** propose this "open problem" kind (or a documented stock
> way to express a phase-gated forced decision) to `claude-project-discipline`.

## Unresolved design problems

Each has a `Must resolve by:` header stating the phase that forces it.

- **[`view-counting.md`](view-counting.md)** — resolve by Phase 4 AppView
  cutover, or earlier if feed ranking uses view counts. Under the external
  monetization model (see `monetization.md`) this becomes the single most
  important signal tortok provides to creators. Load-bearing.
- **[`monetization.md`](monetization.md)** — philosophy decided; architecture
  direction set in Decision 0011 (interface-first, first-party pool committed,
  Stripe+USDC-on-Base leading V1 rail candidate). Two prerequisites remain open
  before V1 rail commitment: Apple App Store Guideline 3.1.1 written position,
  and the tortok US-incorporation decision. Sub-problem A (payout-destination
  Lexicon) is unblocked and resolves by Phase 4, independently of the rail.
- **[`cross-deployment-transport.md`](cross-deployment-transport.md)** — partly
  resolved: runtime sources come from the AppView (Decision 0022). Key layout
  and piece size resolve by Phase 3 Unit 3, before real records fix their
  magnets; mirrors vs seeders by Phase 4. Also covers the permanent content
  domain and durability.
- **[`signed-out-feed.md`](signed-out-feed.md)** — resolve by Phase 4 with
  `view-counting.md`, before public release at the latest. Whether people can
  watch the feed before signing in: easier onboarding and sign-in-free
  production smoke tests, against views with no account behind them.
- **[`own-pds.md`](own-pds.md)** — parked. v1 uses users' existing atproto
  identities (typically `bsky.social`); no tortok PDS is in scope. Documents the
  costs we're avoiding, the risks taken on, and the triggers that would force a
  revisit (and a new decision record).

## Execution risks

Uncertainties that needed a spike or a measurement, not a design decision. All
three sit in now-completed phases (0–2); kept for the record with their outcomes.

1. **WebTorrent on React Native / Hermes.** Does WebTorrent's WebRTC surface work
   on Hermes with `react-native-webrtc`? Was the single biggest rewrite risk.
   **Resolved in Phase 2** — validated by the two-sim P2P spike (89–91% offload);
   see [`../decisions/spikes/phase-2-p2p-offload.md`](../decisions/spikes/phase-2-p2p-offload.md).
2. **Vertically-scrolling video feed in RN.** TikTok-style UX, memory management
   for simultaneously-loaded players, prefetching, gesture feel. **Resolved in
   Phase 1** — the Expo feed shipped with `expo-video`.
3. **P2P offload ratio in practice.** Decision 0008's cost envelope assumed ~50%
   of bytes peer-to-peer. **Measured in Phase 2** at 89–91% between two
   simulators on a local swarm; the real-device tiers (Decisions 0014/0015)
   validate the number survives real NAT and playback.

## Deferred decisions

These become decision records at a specific phase boundary. Listed so they are
not forgotten; each gets a real record when the phase that forces it arrives.

- **Recording requirements, for the future recording plan.** Carried over
  from the retired Swift-era MVP specs; none is decided. Front/back camera
  flip; portrait 9:16 capture at 720p/30 fps; a hard duration cap; a trim
  and caption step after recording; the poster taken from the first frame;
  and a processing budget of under 30 s for a 60 s clip. Open question: the
  specs capped native posts at 15–60 s, but `app.tortok.video.post` allows
  up to 600,000 ms (10 minutes) and bridged Bluesky video runs longer, so
  "short-form means 60 s" needs a decision. Recording must also re-enable
  the blocked Android camera and microphone permissions (see
  [`client.md`](../client.md)).
- **Showing seeding to the user.** Decision 0009 gates seeding on battery and
  network with no visible indicator or toggle. Whether to show seeding
  activity, and whether a power-user "contributor mode" switch exists, is a
  UX decision; the release plan's App Review question may force it before
  1.0.
- **AppView running-cost estimate** (back-of-envelope, 2026-04-29). Indexing and
  feed generation add a small fixed cost on top of the Decision 0008 envelope;
  v1 uses users' existing PDSes so PDS storage and blob egress are zero to us.
  ~$41/mo at 1k DAU, ~$100/mo at 10k, ~$515/mo at 100k. Detailed estimate is
  Phase 4 when real ingest rates are measured.
- **AppView ingest scale.** Decision 0017 settled the source: the AppView
  reads the relay through Jetstream, filtered with `wantedCollections`. What
  stays open is the rate at full network scale and whether a tortok-specific
  relay is ever worth running. Phase 4.
- **`did:web` migration UX.** In-app flow (DNS verification, PLC op, account
  migration) for power users moving off a `bsky.social`-managed `did:plc` (per
  Decision 0003). Not blocking v1; prototype before promising it.
- **Legacy account migration.** Phase 1 shipped against the legacy email/password
  backend; Phase 3 retires the `users` table and affected test/team accounts
  re-onboard via atproto OAuth. Coordinated with Unit 2.5C of the
  Phase 3 plan.
- **R2 reliability and backup strategy.** Weekly backup to Backblaze B2
  (~$5/mo) once the catalog warrants it. Revisit after Phase 4.
- **Fly.io reliability tolerance trigger.** Define a concrete migration trigger
  (e.g. "two P1s in a quarter, or one P0 with data loss") → Hetzner VPS fallback
  for the API, tracker and TURN. Define before the Beta launch so the
  decision is mechanical.

## Explicitly out of scope (v1)

- **Recording / upload UX.** The `Record` tab is a stub; camera capture is a
  separate concern. The Android camera and microphone permissions are blocked
  in `app.json` until then; see [`client.md`](../client.md#implementation-status)
  for what recording must re-enable.
- **Direct platform monetization via ads or paid content.** tortok serves no
  ads, hosts no paid content, and takes no cut of creator earnings. Creators
  monetize externally using trustworthy engagement signals published by their
  PDS, plus the first-party fan-allocated pool (Decision 0011).
- **Self-hosted PDS tooling.** Deferred to post-v1 per Decision 0005.
- **Payment processing / creator KYC / pool payouts for the V1 rail.** Direction
  set in Decision 0011; rail commitment gated on Apple guidance and the
  US-incorporation decision. The external-monetization path needs no tortok-side
  payment processing.
- **Native desktop (macOS, Windows, Linux).** Expo web covers desktop for v1.
- **Social features beyond the feed.** Direct messages, stories and other
  ephemeral content, a sound library, effects and filters, duets and
  stitching, live streaming, and advanced search. (Carried over from the
  retired Swift-era MVP specs, which listed the same non-goals.)
