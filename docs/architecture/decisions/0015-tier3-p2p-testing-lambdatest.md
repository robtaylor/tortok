# Decision 0015: Tier-3 real-device P2P testing runs on LambdaTest/TestMu

**Current architecture:** [P2P & torrent engine](../p2p-torrent.md)

**Status:** Accepted — 2026-11-04. Revises the tier-3 vendor choice of [Decision 0014](0014-device-testing-strategy.md); tiers 1 and 2 of 0014 are unchanged.

**Context.** Decision 0014 split device testing into three tiers and routed
tier 3 (P2P × real-device composition) to AWS Device Farm private devices +
VPC-ENI, on the grounds that it was the one real-device option with *documented*
device-to-device P2P plumbing, and that generic farms were "unproven for
device-to-device P2P." That left tier 3 at ~$400+/mo, us-west-2-only.

The LambdaTest/TestMu architecture team has since answered the open questions
Decision 0014 flagged, and the answers remove the reason AWS was primary:

- **Device egress for WebRTC is unrestricted.** Real devices in their cloud allow
  outbound UDP and STUN/TURN connectivity from an installed app (not just the
  browser); no firewall restrictions on the ports or protocols WebRTC ICE uses.
  This retires the "farm-egress-dependent" caveat that made generic farms a bet.
- **Device↔device P2P works.** Two parallel automated Appium sessions on two real
  devices establish an ICE connection to each other, both app instances signaling
  through our common tracker. As expected for cloud devices behind NAT, the path
  is **TURN-relayed** rather than direct — the same TURN-relay path the AWS option
  would have used. This is precisely the thing Decision 0014 called "unproven."
- **Tracker reachability via Tunnel.** A cloud device reaches a WebSocket tracker
  on our local/staging network through their Tunnel. (Tunnels still do not put two
  devices on a shared subnet; the device↔device link is TURN-relayed, not
  tunnel-bridged.)

Two constraints shape *how* we use it, without changing the conclusion:

- **`appProfiling` network metrics are aggregate only** — total download/upload,
  no WebRTC/UDP-vs-HTTP breakdown — so the farm metric cannot measure the
  P2P-vs-CDN offload split. This changes nothing in practice: Decision 0014
  already names the local two-device harness and tier-1 emulators as the source of
  truth for headline offload numbers, and app-side instrumentation supplies the
  split. Tier 3 validates the number survives real NAT and real playback.
- **Bring your own TURN.** TestMu operate TURN but expect us to bring our own. We
  run our own coturn TURN server regardless (it is also the production path), so
  this is a no-op for the plan — tier 3 uses our TURN, not the vendor's.

**Decision.**

Tier 3 (the one test that genuinely needs two real devices networked — "does P2P
piece-fetching jank the video versus a clean webseed pull, on real hardware, over
real NAT") runs as **two parallel automated Appium sessions on LambdaTest/TestMu
real devices**, both signaling through our WebSocket tracker (reached via their
Tunnel) and connecting over a **TURN-relayed** ICE path using **our own coturn
TURN server**. Offload is measured app-side, not from `appProfiling`. It is still
**stood up only after tiers 1 and 2 are independently green** (Decision 0014's
sequencing is unchanged).

**AWS Device Farm + VPC-ENI is retained as the documented fallback** — if the
two-parallel-session approach proves flaky in practice, or if we later want a
direct (non-relayed) device↔device path that VPC-ENI's shared-VPC model can offer.

**Consequences.**

- Tier 3 drops from ~$400+/mo (AWS private, us-west-2-only) to entry-tier
  real-device pricing on a farm already used for tier 2, on infrastructure we
  control (our tracker, our TURN).
- The device↔device P2P question Decision 0014 treated as an open risk is now
  vendor-confirmed answerable on that farm; the residual risk is execution
  flakiness of two-parallel-session orchestration, for which AWS remains the
  documented backstop.
- Decision 0014 stays Accepted and in force for tiers 1 and 2; only its tier-3
  vendor choice is revised here. Current tier-3 state lives in the
  [p2p-torrent area doc](../p2p-torrent.md).

**Alternatives ruled out.**

- **Keep AWS Device Farm primary.** Its only edge over the generic farms was
  "documented VPC-ENI plumbing"; TestMu's direct confirmation of the device↔device
  case removes that edge at roughly a tenth of the cost. Retained as fallback, not
  primary.
- **Treat TestMu as unverified until we run it ourselves.** The confirmation came
  from the vendor's architecture team, not public docs, so there is residual
  execution risk — but it is cheaper to attempt tier 3 on the farm we already use
  and fall back to AWS than to pay the private-rig premium pre-emptively.
