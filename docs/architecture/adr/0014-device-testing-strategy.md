# ADR-014: Device testing strategy — self-hosted emulators for CI, real devices for video/P2P

**Status:** Accepted — 2026-07-01

**Context.** ADR-009 deliberately scoped the Phase 2 WebTorrent spike
to simulators only and deferred real-device validation to "the phase
where battery and carrier-network behaviour actually matter" — i.e.
now. Phase 2 closed with an 89–91% offload measurement between two
simulators on a local swarm. Phase 3 (and the run-up to any public
launch) needs to answer questions simulators cannot:

- Does video **playback** hold up on real silicon — hardware H.264/AV1
  decode availability, dropped frames, thermal throttling, cold/hot
  startup, FPS under scroll — across the device range users actually
  carry? This is a usability gate, not a nice-to-have: a vertical
  video feed lives or dies on playback smoothness.
- Does **P2P under real conditions** behave — TURN traversal on
  carrier NAT, Wi-Fi gating via NetInfo (ADR-009 decision 2), and
  whether pulling pieces over WebRTC starves the video pipeline
  versus a clean CDN/webseed pull on real hardware?

We surveyed the device-cloud market to decide where each kind of test
should run and what it costs. The survey turned up a structural fact
that shapes the decision: **the thing that makes real-device clouds
hard for TorTok is network control**, and that splits cleanly from the
thing that makes them necessary (real video hardware).

Key findings (vendor docs / list pricing, June 2026):

- **Emulators cannot validate video performance.** AOSP/Genymotion
  emulators decode on the host GPU/software path, so they say nothing
  about real codec hardware, thermal behaviour, or battery-vs-quality
  tradeoffs — exactly the feed-usability signals we need.
- **Emulators are the right home for P2P *logic*.** Self-hosted
  emulators (or Genymotion on EC2) sit in our own VPC, so two peers on
  the same subnet reach each other with zero egress mystery. Cost is
  EC2 compute only (~$25–50/mo idle-to-light; Genymotion adds ~$0.60/hr
  software), and it scales to zero when not running.
- **Generic real-device farms are good at compatibility + performance,
  unproven for device-to-device P2P.** LambdaTest/TestMu AI exposes a
  genuinely useful `appProfiling` capability (CPU, memory, FPS, network
  up/down MB, battery, temperature, ANR with log dumps, cold/hot
  startup) via Appium automation, fetchable as JSON over their API —
  but it is Appium-only (no live-session profiling), and no farm
  documents two of their devices establishing a WebRTC connection to
  each other. Their "multi-device" feature is *parallel manual
  control*, not a shared network — a red herring for P2P. Entry real-
  device tiers start ~$39/mo; BrowserStack App Automate ~$199–249/mo
  for one parallel.
- **AWS Device Farm is the one real-device option with documented P2P
  plumbing.** Its VPC-ENI feature attaches devices to *our* VPC and the
  docs explicitly list supported traffic as "TCP, UDP, web sockets, and
  streaming" — precisely WebRTC + our WebSocket tracker. Caveats: the
  ENI is outbound-only (so TURN-relayed P2P works since both peers dial
  out; pure direct device-to-device may need a TURN hop), VPC
  connectivity is **us-west-2 only**, and the feature is tied to the
  **private-device tier (~$200/mo per device)**. A two-device P2P rig
  is therefore ~$400+/mo. (Open question with AWS: whether VPC-ENI also
  works on the $0.17/min public pay-as-you-go fleet, which would avoid
  the private tier — worth confirming before committing.)
- **Tunnels are not device-to-device VPNs.** LambdaTest Tunnel and
  pCloudy Wildnet bridge a cloud device back to *our* network (to reach
  our tracker/backend); they do not put two cloud devices on a shared
  subnet. They solve the "device reaches our tracker" half, not the
  "two devices reach each other" half.

**Decision.**

Split device testing into three tiers by what each question actually
requires, and pay for real devices only where real silicon is the
thing under test.

1. **CI gate → self-hosted emulators (our VPC).** P2P connection logic,
   offload accounting, and regression smoke run on self-hosted Android
   emulators (or Genymotion on EC2). This is where "do peers connect
   and is offload accounted correctly" is answered, cheaply and
   repeatably, with full network control. Cost target ~$0–50/mo,
   idle-to-zero. This tier is the regression backstop, not the
   usability gate.

2. **Video playback tuning → cheap real-device farm, single device.**
   Decode, FPS, jank, thermal, and startup are tuned on a real-device
   farm using one device at a time, fed from CDN/webseed. Crucially,
   **video performance is largely independent of where the bytes come
   from**, so this needs no P2P networking and no expensive multi-device
   rig. LambdaTest `appProfiling` (or its free/entry tier, or AWS
   Device Farm's 1,000 free trial minutes) covers it. This is the
   primary usability gate.

3. **P2P × real-device composition → AWS Device Farm private rig,
   deferred.** The one test that genuinely needs two real devices
   networked — "does P2P piece-fetching jank the video versus a clean
   webseed pull, on real hardware, over real NAT" — runs on AWS Device
   Farm private devices + VPC-ENI. This rig (~$400+/mo, us-west-2,
   TURN-relay path) is **stood up only after tiers 1 and 2 are
   independently green**, since it composes two things that should each
   be proven first. Before committing, confirm with AWS whether VPC-ENI
   works on the cheaper public fleet.

**Consequences.**

- Real-device video validation arrives early and cheaply (tier 2,
  single device, free/entry tiers), closing the usability gap ADR-009
  left open without waiting on the expensive rig.
- The ~$400+/mo AWS private-device line is not spent until tiers 1 and
  2 have earned the need for it — realistic near-term spend is ~$0–50/mo
  (free tiers + a couple of cheap EC2 instances).
- Execution risk #1 (Hermes WebRTC on real hardware) and the TURN /
  Wi-Fi-gating quirks ADR-009 flagged for "when Phase 2 extends to real
  hardware" get exercised in tier 3, with tier 1 as the fast
  regression net underneath.
- Execution risk #3 (offload ratio in practice) keeps the local
  two-device harness and tier-1 emulators as the source of truth for
  headline offload numbers; the real-device tiers validate that the
  number survives real NAT and real playback, they don't replace it.
- We take on self-hosted-emulator maintenance (headless Android,
  nested virt/KVM, tracker wiring) as CI infrastructure. Acceptable —
  it is the same swarm setup the local spike already runs, lifted into
  CI.

**Alternatives ruled out.**

- **All real devices, all tiers.** Thorough but mis-priced: it pays a
  device-farm premium to answer P2P-logic questions that emulators on
  our own network answer better (no egress mystery) and cheaper.
  Real silicon is reserved for the questions only real silicon can
  answer.
- **All emulators, no real devices.** Cheapest, but structurally
  cannot validate video playback (host-GPU decode hides exactly the
  codec/thermal/FPS behaviour that determines feed usability). Rejected
  on the usability gate.
- **A generic real-device farm (LambdaTest/BrowserStack) for P2P.**
  Their multi-device feature is parallel manual control, not a shared
  network, and none document two devices establishing WebRTC to each
  other. Possible in principle via two parallel automated sessions +
  TURN, but unproven and farm-egress-dependent; not worth betting the
  P2P validation on without a documented guarantee. AWS Device Farm's
  VPC-ENI is the documented path instead.
- **Stand up the AWS private rig now.** Tempting for completeness, but
  it composes video playback and P2P — two things that should each be
  proven independently first. Deferring it until tiers 1 and 2 are
  green is cheaper and isolates failures.
- **pCloudy Wildnet / LambdaTest Tunnel as the P2P enabler.** These
  bridge cloud devices to *our* network, not to each other; they don't
  unlock device-to-device P2P. Useful only for exposing our tracker,
  which tier 1 doesn't need (own VPC) and tier 3 gets from VPC-ENI.

**Relationship to ADR-009.** This ADR resolves the real-device
deferral ADR-009 left open ("real-device testing moves into the phase
where battery and carrier-network behaviour actually matter"). ADR-009
decision 1 (simulators-only) stands as the Phase 2 record; this ADR
defines what comes after it. The TURN/NetInfo Wi-Fi-gating quirks
ADR-009 predicted for real hardware are the substance of tier 3.
