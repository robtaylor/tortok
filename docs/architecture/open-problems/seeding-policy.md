# Open problem: Seeding policy (client and server)

**Status:** Server side **resolved** (Phase 0b, demand-pull only).
Client side **resolved** (ADR-009, scroll-back window on mobile,
battery-gated aggressive on desktop/web). The concrete battery
numbers in ADR-009 are starting guesses — the Phase 2 spike
validates them. This file is kept as context for the starting
numbers and as the place where any policy change gets re-debated
before a new ADR supersedes ADR-009.
**Must resolve by:**
- **Server pre-warming:** ~~Phase 0b~~ **Resolved.** Ship with
  demand-pull caching only for initial deploy. All three pre-warming
  strategies (most-views, trending, recently-added) are documented as
  a known next step once we have real traffic data; adding them later
  is a config change, not an architectural shift.
- **Client seeding:** ~~Phase 2~~ **Resolved (ADR-009).** Mobile
  default is policy 2 (scroll-back window), desktop/web default is
  policy 3 (battery-gated aggressive). Validate during Phase 2 spike.
**Related ADRs:** ADR-001 (WebTorrent), ADR-008 (four-layer infra),
ADR-009 (Phase 2 client seeding scope and policy).

## Sub-problem A: Server-side pre-warming

### The problem

ADR-008 specifies L2 as "Fly.io seeders that pull content from R2 on
first request and cache locally." That's passive demand-driven
caching — the seeder holds only what regional viewers have recently
asked for. The open question is whether we should *also* proactively
pre-warm popular content on every L2 seeder so:

- Viral videos are instantly available in every region
- New videos pushed from our own account are seeded before any user
  requests them
- A cold regional seeder (just provisioned, just rebooted) isn't
  useless for the first hour

### Candidate strategies

PeerTube shipped three named strategies in production; they're
worth borrowing verbatim as a starting point.

1. **`most-views`** — pre-cache the top N videos by view count from
   the last 7 days.
2. **`trending`** — pre-cache videos whose view rate is accelerating
   (derivative of views, not absolute views).
3. **`recently-added`** — pre-cache the last N videos published on
   our PDS regardless of popularity, so new uploads are warm from
   the first viewer.

PeerTube runs all three with a per-strategy byte budget and an LRU
eviction policy once the budget is full.

### Concrete starting numbers to decide

- `N` = 100 videos per strategy
- Per-seeder storage budget: **100 GB** (fits comfortably on the
  smallest Fly volume)
- LRU eviction when budget is hit
- Refresh cadence: every 30 minutes for `trending` and
  `recently-added`; every 6 hours for `most-views`

These numbers are guesses. Revisit once we have P2P offload
measurements (see open question #12 in `decisions.md`).

### Why this isn't just "do what PeerTube does"

- Our catalog is smaller and our traffic pattern at launch is
  unknown. `most-views` may not have a meaningful ranking until
  we have thousands of videos.
- Our view counts are themselves an open problem (see
  `view-counting.md`). A pre-warming strategy that depends on view
  counts is only as trustworthy as those counts.
- The simplest viable answer — **demand-pull only, no pre-warming**
  — might be enough for launch. Ship that, measure, add
  pre-warming if cold-start latency is visibly bad.

### Decision (Phase 0b)

Ship with **demand-pull caching only.** The three pre-warming
strategies (most-views, trending, recently-added) are recorded as a
known next step. Adding pre-warming later is a config change in the
seeder, not an architectural shift.

All three strategies will be implemented once we have real traffic
data to calibrate N values and refresh cadences. The concrete
starting numbers (N=100, 100 GB LRU cap, 30-min/6-hr refresh) are
still the plan for when we turn pre-warming on.

## Sub-problem B: Client-side seeding (battery-sensitive)

### The problem

The Expo client can seed content on behalf of the swarm. This is
load-bearing for the P2P-offload thesis in ADR-008 — if clients
don't seed, every byte comes from our webseed and the "50% P2P
offload" cost envelope collapses. But mobile seeding costs battery,
and battery cost drives users away.

### Battery impact (order-of-magnitude numbers)

These are from prior research in the Nov 2025 `technical-challenges`
doc, which in turn cites PeerTube/WebTorrent operator reports. Treat
as rough calibration, not measurements we've taken ourselves:

| Seeding policy | Battery impact per active seeding hour |
|----------------|----------------------------------------|
| Uncontrolled (seed while open) | **15–25%** |
| "Seed only when battery > 50%" | **5–8%** |
| On-demand only (seed the video currently playing) | **2–3%** |

These ranges are from 2024-era libtorrent clients on Android and
iOS. WebTorrent over WebRTC on Hermes is probably in the same
ballpark but we have no measurements.

### Candidate policies

1. **On-demand only.** Client seeds only the torrent currently
   playing, and stops seeding when the user scrolls past the video.
   Minimum battery cost; minimum P2P contribution.
2. **Scroll-back window.** Client seeds the last N videos it
   watched (N = 5 or 10) for M minutes (M = 30 or 60) after
   viewing. Modest battery cost; modest P2P contribution.
3. **Battery-gated.** Client seeds aggressively when charging or
   battery > 80%; on-demand only when battery < 50%; nothing when
   battery < 20%. Rewards users who plug in.
4. **User opt-in "contributor mode".** An explicit setting; off by
   default; for users who want to help and don't mind the battery
   hit. Desktop/web clients default to on.

All four can coexist with the self-hosted seeder ecosystem from
ADR-008 L4 — home-server operators carry most of the sustained
load, mobile clients contribute opportunistically.

### Resolved in ADR-009 (2026-04-14)

Mobile ships with **policy 2 (scroll-back window), Wi-Fi only**:
seed the last 5 videos watched for 30 minutes post-view, foreground
only, battery > 30%, and **not over cellular**. Desktop/web ship
with **policy 3 (battery-gated aggressive)**.

The Wi-Fi gate is a cost control, not a battery concession —
cellular NAT typically forces TURN relay, which costs us money on
coturn. Home-router Wi-Fi is mostly direct-connectable.

The numbers are starting guesses. The Phase 2 spike measures actual
battery impact and TURN relay rate; if policy 2 costs more than
~5%/hour in practice (or TURN relay rate stays high even on Wi-Fi),
degrade to policy 1 (on-demand only) in a new ADR that supersedes
ADR-009's policy clause.

## Unresolved sub-questions

1. **What is the actual P2P offload ratio at policy 1, 2, and 3?**
   This is open question #12 in `decisions.md`. Answering it changes
   the server pre-warming math.
2. **Does WebTorrent on Hermes actually seed from a phone reliably?**
   This is open question #1 in `decisions.md`. If RN's WebRTC surface
   is inbound-connection-hostile, phones can only consume — they
   can't serve peers. In that case only desktop/web clients and the
   L4 community seeders contribute, and ADR-008's cost envelope
   needs to be revisited.
3. **How do we surface seeding activity to the user?** A TikTok user
   doesn't want to see a P2P dashboard. A power user might. UX decision.
4. **Per-user PDS storage quotas.** Unrelated to seeding, but raised
   by the same area of the old docs — what's the default upload
   quota on our PDS (`videoQuota`, `videoQuotaDaily`)? Affects
   abuse surface and infrastructure cost. Decide during Phase 3.

## What a resolved version looks like

- ~~A paragraph added to ADR-001 or a new ADR-009 that picks the
  client-side policy and states the battery-gate numbers~~ **Done
  (ADR-009, 2026-04-14).**
- ~~A paragraph added to ADR-008 that picks the server pre-warming
  strategy (or explicitly commits to demand-pull only at launch)~~
  **Done (ADR-008 + Phase 0b commit to demand-pull only).**
- Real P2P offload measurements from Phase 2, not the 50% guess
  — *still open, the Phase 2 spike produces this.*
- Per-PDS upload quota defaults documented alongside ADR-005 —
  *still open, Phase 3.*
