# tortok release plan

**Status:** Active — launch plan, first dated 2026-04-17.

This document is the operational launch plan for tortok. It sits
underneath the architecture decisions in [`../architecture/decisions/README.md`](../architecture/decisions/README.md)
and consumes them; if a release-plan choice contradicts a decision record, the
decision record wins or gets superseded.

Companion documents:
- [`../architecture/README.md`](../architecture/README.md) — the architecture this plan launches.
- [Decision 0010](../architecture/decisions/0010-bluesky-video-bridge.md) — the inbound Bluesky bridge,
  load-bearing for the cold-start solution below.
- `../architecture/open-problems/monetization.md` — the monetization
  philosophy and the in-progress first-party pool design.

---

## Wedge / public story

**"Your videos. Your followers. Yours to take anywhere."**

The frame: *creators and audiences in control*. The substrate
(AT Protocol, BitTorrent, no platform takes from creators) is
implementation detail the user never has to care about — the proof
is shown, not told. The Bluesky bridge (Decision 0010) is how we show it
visually within seconds of opening the app.

What we **don't** lead with publicly:
- "Decentralized" as a noun — too abstract for non-builders
- "No corporate control" — defined by what we're against, attracts
  the wrong first 200 users (puts us in the Mastodon / Truth
  Social / Gab memetic bucket)
- "P2P video" — implementation detail
- "Free of moderation overhead" — sounds like an invitation to the
  worst of the internet; not what we are

What the architecture lets us prove if asked:
- Creator's follow graph is portable (AT Proto)
- Creator's posts are signed records in their own repo, so no single
  company holds them. The video bytes are a different story: today they
  depend on tortok's R2 origin (see
  [`cross-deployment-transport.md`](../architecture/open-problems/cross-deployment-transport.md))
- Platform doesn't take a cut of creator earnings (monetization
  philosophy + Sub-problem C of `monetization.md`)
- Federated with Bluesky (Decision 0010)

---

## Release shape

Three stages: **Beta**, **Ramp** and **1.0**. Beta and Ramp run in
parallel from launch day. 1.0 is a *promotion event*, triggered by
either readiness or an exogenous catalyst. Decisions 0010 and 0011
predate these names and call the stages Phase A, Phase B and Phase C.

### Beta — Open beta

- **TestFlight Public Link** (iOS) — open registration via URL, no
  invite gating. Hard cap: 10,000 active testers.
- **Play Open Testing** (Android) — open registration via Play
  Store URL, no cap.
- **Web** (PWA, mobile-responsive) — no install gate, no cap.
  **First-class surface, not an afterthought** — primary discovery
  channel because it embeds in Bluesky and shares as a URL.

No invite-only phase. (See "Lessons from the cold-start research"
below — Bluesky's 21-month closed phase cost them at least one
exodus catalyst.)

### Ramp — Engine ramp (overlapping Beta from day one)

- Hand-emailed creator outreach (Track 1 below)
- Bluesky bridge (Decision 0010) carries the cold-start load
- Iterate UX based on real usage; ship fast
- Load test the tracker, TURN and content origin under simulated
  catalyst load
- Build and tune the native upgrade funnel from bridged content

### 1.0 — App Store and Play Store promotion

Triggered by either:
- **Readiness** — product feels unembarrassing, infra has been load
  tested, monetization V1 is in fans' hands
- **Catalyst** — exogenous shock (TikTok ban, Meta deplatforming
  scandal, X meltdown) that creates a soft-landing window

The 1.0 submission is a *promotion*, not a launch. Story:
"the open-beta thing you've been hearing about is now on the
App Store." Stronger position for App Review ("we're already
operating at this scale") and unlocks App Store search discovery.

Coordinated with: one HN launch (the only one), one substantive
Substack/long-form essay, seed creators amplifying.

### Beta launch criteria (must be true before opening the link)

- Decision 0010 inbound bridge live, with opt-out tested in CI
- Web client production-grade (not a stub) — primary share surface
- Tracker and content origin load-tested at 10k concurrent peers on
  a single torrent
- Staging environment, image promotion and production monitoring in
  place (WS3 and WS4 of
  [`environments-staging-production-and-their-checks.md`](environments-staging-production-and-their-checks.md))
- Cost floor verified — see Track 4
- TestFlight build with 90-day-renewal release rhythm in place
- App Store Review Guidelines (Apple §1.2 UGC, §5.2 IP) read; we
  have rehearsed answers for the bridged-content moderation
  question
- Crash and error reporting wired (so we can iterate fast in
  Ramp)

---

## Five operational tracks

### Track 1 — Creator outreach

Three concentric tiers:

- **Halo (~10–20)** — Mid-to-large creators (50k–500k on TikTok/IG)
  who have publicly posted about shadow-banning, demonetization, or
  platform politics, **and** are already active on Bluesky. Their
  *presence* is the marketing — one reply-quote from them is worth
  a week of grinding. Hand-email personally, no template.
- **Engine (~50–100)** — Mid-tier (5k–50k) creators in undermonetized
  niches (harm reduction, sex ed, alt-medicine skeptics, indie
  music, weird art) — the demos most aggressively suppressed by
  algorithmic feeds. These are the people who actually post
  regularly. Hand-email but template-allowed.
- **Long tail** — open registration, no outreach. They show up
  because the engine is posting and the bridge is live.

Sourcing method: search Bluesky for "shadowban", "deboosted",
"demonetized", "this won't get views"; check who they follow; the
graph clusters fast. Confirmed real demand signal in the Halo demo
as of 2026-04-17 — multiple creators the founder follows are
publicly complaining about TikTok and Instagram suppression.

Outreach script lives in **section "Outreach copy" below**.

Decision 0010 changes the ask economics. We are *not* asking creators to
move — we are showing them their content already plays in tortok.
The hand-email is closer to "would you also post natively for the
durability/portability upgrade?" — much smaller commitment.

### Track 2 — Guerilla marketing

Highest-leverage move: **show, don't tell.** Every tortok video
embedded in a Bluesky thread is an ad for tortok; every bridged
Bluesky video that "looks better in the tortok player" is an ad for
tortok. Make embeds and bridges flawless before any other marketing.

Beyond that:

- **Reply guy with a soul.** When a creator publicly complains about
  shadow-banning on Bluesky/X, occasionally reply with empathy and
  maybe a link. Personal, not automated. Don't be a bot.
- **One Substack essay.** "What ownership actually means on the
  open social web" or similar — pitched to creator-economy
  newsletters (Hung Up, Means of Creation, Embedded) for
  cross-post. One essay, well-written, shareable; not a content
  series.
- **One HN launch — exactly one.** When the product is
  unembarrassing. HN cares about decentralization-for-real, which
  is structurally aligned with the wedge.
- **Pre-cleared App Review story.** Have the answer to "what about
  bridged moderation?" ready before submission.

Explicitly **not** doing:
- Paid ads (burns cash, attracts the wrong audience, contradicts
  the pitch)
- Marketing on TikTok/Reels (using the platforms we critique is bad
  optics)
- Influencer paid posts (same)
- Discord community grinding (low yield for the time cost)

### Track 3 — Federation strategy (cross-cutting)

Two directions, both load-bearing.

**Inbound (Decision 0010, Phase 3 Unit 2.5D):** Bluesky video posts render natively
in the tortok feed. This is the cold-start solution — a new tortok
user sees real content from real creators on day one without us
having onboarded a single tortok-native creator.

**Outbound (Phase 3 Unit 3 onwards):** tortok video posts embed
natively in Bluesky timelines. Every shared tortok URL on Bluesky
becomes a recruitment surface. This is the reason the web client must
be production-grade by the Beta launch: Bluesky embeds open in a web
view first, app second.

Together these form the unified federation pitch: "same network,
different lens." Without both, the pitch is asymmetric and feels
parasitic in one direction.

**Native upgrade funnel.** Bridged posts include a creator-facing
"post natively to tortok" affordance. Until Phase 3 ships full
native posting, this is a "notify when available" capture. Once
Phase 3 ships, it's the conversion event.

### Track 4 — Catalyst readiness

Two failure modes to plan against:

**Cash burn before catalyst.** Solo dev, no salary burn. Floor is
infra: R2 + the Fly.io API, database, tracker and coturn + domains + Apple/Play
developer accounts + a small dev sandbox. Per Decision 0008 the idle
floor is roughly $30–$50/mo at zero users. Add Apple ($99/yr) and
Play ($25 once) and you're looking at ~$50/mo durable.

**Catalyst-readiness target: sit at the floor for 12+ months
without flinching.** Anything that can't be paused (long contracts,
paid services with minimums, paid SaaS with annual commits) is the
enemy until the wedge proves itself. No paid analytics, no paid
error reporting beyond free tiers, no paid email service beyond
free tiers, no paid moderation tooling. All of these can be added
after demand is real.

**Infra collapse during catalyst.** Bluesky had outages during every
X exodus moment. Our P2P architecture is *better positioned* for
spike absorption than a centralized service (peer bandwidth
contributes), but only if the bootstrap path doesn't fall over.
Specifically the tracker, the content origin, and (for bridged
content) the AppView's Jetstream subscription must scale or fail
gracefully.

**Pre-launch load test.** Simulate 10k concurrent peers on a single
torrent against our tracker and content origin. If it falls over, fix before
opening the TestFlight link. Ditto for the bridge ingest under
firehose-event spike conditions.

### Track 5 — Creator monetization

Stub. Detailed design lives in
`../architecture/open-problems/monetization.md`. Today's release-plan
discussion contributed Sub-problem C (the first-party PWYW
"support open content" pool with fan-allocated distribution).

What this track needs to deliver before Ramp graduates:
- Sub-problem A shipped: `app.tortok.payout.destination` lexicon for
  external-link payout surfaces (Patreon, Substack, etc.) on
  creator profiles
- Sub-problem C's rail chosen. Decision 0011 committed to the
  first-party pool and named Stripe+USDC-on-Base the leading rail,
  pending Apple's Guideline 3.1.1 position and the US-incorporation
  decision

**Not blocking Beta.** Beta can launch with the wedge story
intact and "monetization coming soon" honest. Creators don't need
to be paid by tortok in week 1 — they need the *promise* of being
paid in a way the wedge respects.

---

## Sequencing & dependencies

Hard dependencies (must be true before the named milestone):

| Milestone | Hard dependencies |
|-----------|-------------------|
| Beta | Decision 0010 bridge live; web client prod-grade; tracker and origin load test passed; staging and monitoring in place; outbound embed prototype working in Bluesky |
| Ramp graduation | Sub-problem A shipped; pool rail chosen; engine creators (50+) actively posting native content |
| 1.0 promotion | Catalyst window OR ≥3 months of stable Ramp operation; App Review pre-clearance; HN/essay launch coordinated |

Soft dependencies (nice to have, not blocking):

- Decision 0006 Phase 4 AppView work (ingest hardening, view
  counting, ranking) — not user-visible at Beta
- `view-counting.md` resolution — needed for external monetization
  trust; not needed for Sub-problem C's fan-allocated pool

---

## Lessons from the cold-start research (informing this plan)

Source: 2026-04-17 oracle research on TikTok, Instagram, and
Bluesky launches.

1. **The empty-feed problem is the only problem; everything else
   is downstream.** Solved here by Decision 0010, full stop.
2. **Hand-curated taste-maker seeding beats broad acquisition for
   tiny teams.** Instagram's model, not TikTok's. We have no ad
   budget; the Halo + Engine outreach is the only acquisition
   channel that works at our scale.
3. **Ride a bigger platform's graph; don't try to recreate it.**
   AT Proto / Bluesky is our Twitter-of-2010. Inbound and outbound
   federation are how we ride it.
4. **Catalysts are exogenous; preparedness is what we control.**
   1.0 is a readiness-or-catalyst trigger, not a calendar date.
5. **Subtract before you add.** Pick one public story (the wedge),
   bury everything else. The architecture is the proof, not the
   pitch.
6. **One thing not to copy: Bluesky's invite-only phase.** Cost
   them at least one exodus catalyst window. We open from day one.

---

## Outreach copy (Track 1)

Working draft. Refine before any send.

> Hey [name] —
>
> I've been following your stuff on Bluesky / [other platform], and
> the recent [thread/post] about [shadow-banning / suppression /
> deplatforming / specific complaint] caught me.
>
> I'm building tortok — short-form video on the AT Protocol stack,
> so your follow graph is yours, your content is durable beyond any
> single company, and the platform doesn't take a cut of what you
> earn. Your existing Bluesky video posts already render in
> tortok's feed (with your permission and a link back to you), so
> there's no "move" — just an option to post natively when you want
> the durability/portability upgrade.
>
> Open beta is launching [timeframe]. Would you be open to me
> sending you the TestFlight / Play link when it goes live? No
> pressure to post, just want creators whose taste I respect to see
> the early version.
>
> [signature]

Key properties:
- Specific to the recipient's recent public complaint (not a blast)
- Lead with the wedge, not the tech
- Frame the ask as zero-commitment ("see the early version")
- Honor the bridged-content opt-out by default ("with your
  permission")
- Don't over-explain the architecture; offer to talk if they want

---

## Open questions

- **Specific seed creator list.** Need a Bluesky scout pass to
  identify Halo and Engine candidates. Defer until ~6 weeks before
  the Beta launch so the list is fresh.
- **Cost floor verification.** Need an actual infra cost audit at
  current zero-traffic state to confirm the ~$50/mo target.
- **Substack essay outline.** Topic: ownership on the open web. Author
  voice / pitching strategy TBD.
- **App Review pre-clearance.** Worth a low-stakes inquiry before
  1.0 — ask Apple Developer Relations whether bridged-content
  rendering raises any §5.2 IP flags. Battery is a second review risk:
  Apple rejects apps that drain the battery in the background, and the
  retired MVP specs called for a visible seeding indicator and a user
  toggle. Decision 0009 chose automatic battery and network gating with
  no visible control; decide before 1.0 whether App Review needs one.
- **Playback and battery targets.** The retired MVP specs proposed
  video start under 3 s, no rebuffering after the first load, and battery
  drain under 10 %/h while watching (under 7 %/h on iOS). None is a launch
  criterion today. Decide whether to adopt them as Beta criteria, and
  measure them in the real-device tiers (Decisions 0014, 0015).

---

## What this document does not cover

- Detailed UX specifications (separate concern)
- Detailed load-test plan (engineering ticket)
- Specific ad / press budget — there isn't one and there shouldn't
  be one until the wedge is proven
- Post-1.0 roadmap (premature)
- Hiring plan (premature)
