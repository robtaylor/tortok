# Spike — Does WebTorrent P2P work on the client and deliver meaningful offload?

**Status:** Resolved (2026-04-29) — YES; two-simulator P2P measured 89–91% offload; WebTorrent runs on Hermes with polyfills.

<!--
A resolved spike is never deleted or archived; the decisions that follow from it
cite it. This spike closes out the Phase 2 execution risks that the old flat
decisions index tracked (WebTorrent-on-Hermes and the real offload ratio).
-->

## Question

Does WebTorrent's WebRTC surface run on the React Native / Hermes client, and
does peer-to-peer piece exchange deliver a meaningful share of video bytes
(the offload ratio Decision 0008's cost envelope assumes)?

## Why this is in question

Two of the biggest rewrite risks rode on it. Decision 0008's cost model assumes
~50% of bytes are served peer-to-peer; if WebTorrent can't run on Hermes, or if
real offload is near zero, the P2P thesis collapses and every byte comes from R2
(still viable on free egress, but degraded). Decision 0009's client seeding
policy also needs a working engine to seed from.

## Approach

- **Q1.** Does WebTorrent initialise and exchange data on Hermes at all?
  - Stand up the two-simulator swarm against a local `ws://localhost:8000`
    tracker (public `wss://` trackers leak phantom peers from prior sessions).
  - Add the Hermes polyfills (`self`, `AbortSignal.timeout`) so BEP-19 webseed
    fetches don't fall back to a slow 6s WebRTC path.
- **Q2.** With two clients on the swarm, what fraction of bytes arrives P2P
  versus from the webseed origin? Measure app-side.

## Decision matrix

| Outcome | Means | Action |
|---|---|---|
| Q1 fails | WebTorrent unusable on Hermes | P2P offload → 0; rely on R2; revisit Decision 0001 |
| Q1 passes, Q2 low | Engine works but offload thin | Keep engine; revise Decision 0008 cost model |
| Both pass | P2P viable | Decisions 0001/0008/0009 hold; proceed to real-device validation |

## Findings

- 2026-04: WebTorrent initialises on Hermes once the `self` and
  `AbortSignal.timeout` polyfills are in place; without them, webseed fetches
  fall back to the slow WebRTC path (~6s).
- Never pass `name:` to `webtorrent.seed()` — fs-chunk-store looks content up by
  torrent name and 404s every piece otherwise.
- The local `ws://localhost:8000` tracker is required; public `wss://` trackers
  surface phantom peers from earlier sessions.
- 2026-04-29: two-simulator local swarm measured **89–91% offload** between the
  two peers.

## Outcome

Both sub-questions passed: WebTorrent runs on the Hermes client with the
polyfills, and two simulators on a local swarm exchanged 89–91% of bytes
peer-to-peer — comfortably above Decision 0008's ~50% assumption. Decisions 0001,
0008, and 0009 hold on the strength of this. The number is a two-simulator,
same-host measurement; whether it survives real NAT, carrier networks, and real
playback is the job of the real-device tiers (Decisions 0014 and 0015), not this
spike.
