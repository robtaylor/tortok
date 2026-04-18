# Open problem: Monetization

**Status:** Philosophy decided. Architecture direction set in
ADR-011 (interface-first payout, first-party pool committed,
Stripe+USDC-on-Base leading V1 rail candidate). Rail commitment
gated on two prerequisites.
**Must resolve by:** Sub-problem A (payout-destination Lexicon) —
Phase 3, not rail-dependent. Sub-problem C (first-party pool rail) —
before V1 pool launch, gated on P1 (Apple App Store position) and
P2 (US-incorporation decision). Sub-problem B (general pool
primitive) — deferred to V2.
**Blocks:** First-party pool implementation; in-app surfacing of
creator payout destinations.
**Related ADRs:** ADR-002 (AT Protocol + Lexicons), ADR-005 (own PDS
+ AppView), **ADR-011 (monetization architecture)**.

## The philosophy (decided)

**TorTok is an attention platform, not a monetization platform.**

Creators monetize externally — Patreon, host-read sponsorships inside
videos, merch drops, direct deals, Substack paid subscriptions.
TorTok's job is to make those external deals viable by providing
*trustworthy engagement numbers* creators can show to sponsors.

This choice is load-bearing. It means TorTok:

- **Does not serve ads.** No ad network integration, no header
  bidding, no tracking pixels, no third-party cookies. Ad-supported
  creators use host-read ads recorded into the video itself.
- **Does not host paid content.** Every video is public, torrentable,
  and streamable from the R2 origin. No paywalls, no DRM, no gated
  feeds. Paid content would break the ADR-008 R2+P2P model and force
  an entirely different auth-gated origin path; the simplest way to
  avoid that cost is to not build paid content.
- **Does not custody creator money.** No Stripe Connect account, no
  1099 generation, no international payout infrastructure, no tax
  residency decisions forced by payment regulation. The corporate
  entity requirements collapse.
- **Does not store payout PII.** Because we don't handle money, we
  don't need legal names, tax IDs, bank routing numbers, or
  government ID for payouts. The "PII lives outside the PDS" concern
  goes away — there's no payout PII to separate.

What TorTok *does* provide:

- **Trustworthy engagement numbers** (views, likes, shares,
  completion rate) that creators can screenshot and send to sponsors.
  This is why `view-counting.md` is now the most important open
  problem in the repo — it's the one thing external monetization
  relies on us for.
- **A profile surface where creators can publish external monetization
  links** — Patreon URL, Substack, merch shop, YouTube channel, etc.
  These go in the user profile record on our PDS and federate
  normally.
- **Optional: federated pool→payout primitives** — see sub-problem B
  below. This is additive and doesn't change anything above.

## Sub-problem A: Creator payout destination lexicon

**Status:** Not yet designed.
**Must resolve by:** Phase 3, when the PDS is live and the first user
profile records exist.

When a creator wants to link to their Patreon, the simplest answer is
a `description` field on their profile with a URL in it. That's good
enough for launch. The better answer is a structured lexicon that:

- Lets clients render payout destinations as rich affordances
  ("Support on Patreon" button, Lightning QR code, etc.) instead of
  raw URLs
- Is extensible — new destination types can be added without a
  schema migration
- Is opt-in per destination — some creators want Patreon visible,
  others only want a Lightning tip button
- Signs each destination with the creator's DID, so a third party
  can verify "yes, this Patreon URL was actually published by the
  account claiming to own it" (one of the things creators pay human
  reviewers for today)

Sketch:

```json
{
  "$type": "tortok.payout.destination",
  "kind": "patreon" | "substack" | "lightning" | "url" | ...,
  "value": "https://patreon.com/alice" | "alice@getalby.com" | ...,
  "label": "Support on Patreon",
  "createdAt": "..."
}
```

A creator publishes one record per destination. Clients fetch all
records of this type from a creator's repo and render them on the
profile page.

**Decision to make in Phase 3:**
- Which destination kinds do we ship at launch? (Probably:
  `patreon`, `substack`, `url`. Lightning is great but adds UX
  complexity — defer.)
- Do we validate URLs at publish time or trust the creator?
- Do we surface verification status ("this Patreon link belongs to
  a creator who has proven ownership") or treat all destinations as
  unverified?

## Sub-problem B: Optional federated pool→payout primitives

**Status:** Philosophy aligned. Design open.
**Must resolve by:** Before we announce any pool feature publicly.
Not blocking v1.

The user-facing value: "anyone should be able to run a creator pool"
— a collective of fans contributes to a pool, and the pool operator
distributes to creators based on some formula (views, likes,
engagement, equal split). TorTok does not operate the pool. TorTok
provides the substrate the pool operator reads from.

What TorTok needs to expose for this to work:

1. **Stable creator identity** — already handled by DIDs (ADR-003).
2. **Trustworthy engagement data** — depends on `view-counting.md`.
   A pool operator distributing by view count needs numbers they
   can defend to contributors. This is the same trust problem
   external monetization already has.
3. **A way for creators to opt into a pool** — a signed record
   saying "I, DID X, accept payouts from pool Y on terms Z." This
   prevents a pool operator from claiming to represent creators who
   never agreed.
4. **A way for pool operators to publish pool state** — which
   creators, what formula, what payout schedule, total collected,
   total distributed. A signed record from the pool's own DID.

Sketch lexicons:

```json
// Published by the pool operator's DID
{
  "$type": "tortok.payout.pool",
  "name": "The Cozy Streamer Collective",
  "formula": "engagement_weighted" | "equal_split" | "view_share",
  "payoutCadence": "weekly" | "monthly",
  "contributionEndpoint": "https://pool.example/contribute",
  "stateEndpoint": "https://pool.example/state.json",
  "createdAt": "..."
}

// Published by the creator's DID
{
  "$type": "tortok.payout.poolAcceptance",
  "pool": "did:plc:poolOperator",
  "acceptedTermsHash": "sha256:...",
  "acceptedAt": "..."
}
```

The pool operator runs whatever they want off-chain: a Stripe
business that collects donations and PayPal-payouts creators, a
Lightning wallet with automated splits, a DAO with a smart contract,
a volunteer bookkeeper with a spreadsheet. TorTok doesn't care.
TorTok's only job is to host the lexicon records and make the
engagement signals the pool formula reads from.

**Open sub-questions:**

1. **Trust model.** A fan contributing to a pool is trusting the
   pool operator to actually distribute the money. TorTok can
   surface pool-operator reputation (labeler? review system?) but
   can't enforce distribution. What's the UX for "contribute at your
   own risk"?
2. **Pool discovery.** Do we surface pools in the app (e.g., a
   "Support this creator's pool" button next to videos) or leave
   discovery entirely to third-party clients? Surfacing pools in the
   first-party client means we implicitly endorse them, which has
   moderation implications.
3. **Formula transparency.** Does the `tortok.payout.pool` record
   include enough detail that a contributor can verify the
   distribution was fair? (Probably yes, via a published
   `stateEndpoint`, but the exact format is open.)
4. **Abuse cases.** A scam pool that collects money and never
   distributes. A creator who opts into 50 pools simultaneously to
   farm signal. A pool operator who pays themselves 100%. All of
   these need thinking.
5. **Legal exposure for TorTok.** Even though we don't touch money,
   hosting pool records creates *some* regulatory surface (at minimum,
   the same surface Patreon-link hosting creates). Worth a legal
   review before shipping.

## Sub-problem C: First-party "support open content" pool

**Status:** Concept aligned, mechanism open.
**Must resolve by:** Before any subscription / pool product is
announced or shipped. Not blocking v1.
**Added:** 2026-04-17, during release-plan discussion.

The release-plan conversation (`docs/release-plan.md`) settled the
public wedge as **"your videos, your followers, yours to take
anywhere"** — a creator-and-audience-in-control framing. That framing
forecloses any monetization mechanism that looks like the platform
extracting from creators (no ad rev share, no take of creator
payments, no platform-controlled distribution). It also makes the
"what's the *positive* monetization story for fans?" question
sharper.

The candidate that emerged: a **pay-what-you-think-it's-worth
monthly subscription** that pools fan contributions and lets each
subscriber **manually allocate their pool to creators they
follow/choose**, with auto-distribution across follows as a fallback.

The interesting structural property is *fan-side curation, not
platform-side or formula-side distribution*. Patreon doesn't scale
for fans — nobody can run 50 × $5/mo subscriptions. A single $20/mo
"open content support" pool that the fan splits across 5–10 creators
is the missing product in the creator economy and is directly
aligned with the wedge ("you control where the money goes").

Why it doesn't simply collapse into Sub-problem B's "anyone can run
a pool" model: this one is *first-party*. TorTok would publish it,
brand it, and onboard fans into it as the default monetization
surface. That contradicts the existing principle in this file that
"TorTok does not operate the pool." The contradiction is genuine
and needs resolving in the eventual monetization ADR.

**Resolution candidates for the operating mechanism (preserves
"TorTok does not custody creator money"):**

1. **Fiscal host (Open Collective or similar).** Open Collective
   handles donations, transparency reports, and creator
   reimbursements under a registered nonprofit fiscal host. TorTok
   publishes the pool, brands it, drives signups; the host holds
   the money and pays out. TorTok still doesn't custody.
2. **Stripe + stablecoin (USDC on Base) payouts.** Fans pay by card
   into a tortok-operated Stripe account; Stripe's "Stablecoin
   Payouts for Connect" disburses USDC to each creator's Base wallet
   on a programmable schedule. Tortok holds fiat briefly while a
   distribution batches, then everything exits to creator-controlled
   addresses.
3. **Lightning / Bitcoin native.** Subscribers fund a pool wallet
   under a service like Strike or Alby; payouts are Lightning
   addresses (creators provide their own Lightning address per
   Sub-problem A). TorTok holds no fiat, no bank rails, no KYC
   exposure. Smaller addressable audience (Lightning-literate
   creators and fans).
4. **Patreon for tortok itself.** TorTok has a Patreon; subscriber
   funds flow there; tortok pays creators. **Rules itself out** —
   tortok would be custodying creator money, which the existing
   philosophy explicitly rejects.
5. **Smart contract (Ethereum / Solana) pool.** Fan funds, on-chain
   distribution by signed allocation. Fully non-custodial for tortok.
   Punishingly narrow user base; introduces crypto-UX that
   contradicts "frictionless familiar signup" from ADR-007.

### Research findings (2026-04-17)

Two oracle research passes verified candidates (1) and (2). Both
rails have real blockers; neither is a drop-in answer.

**Open Collective / fiscal host (candidate 1) — blockers surfaced:**

- **Distribution is not automated.** Open Collective's primitive is
  the *expense* — each payout is a manually-approved line item with
  an invoice/receipt. Formula-driven automatic distribution across
  50+ creators on a monthly cadence is not a supported flow; it
  would require off-platform automation that generates expenses
  which the host still approves individually. The "click to create
  your own pool, let a formula distribute" pattern collapses.
- **Policy fit is hostile.** Open Source Collective explicitly
  rejects non-code projects. Open Collective Foundation is winding
  down (platform risk — hosts have closed with funds frozen mid-year).
  Social Change Nest (UK) is possible but UK-scoped and slow. No
  host has publicly taken a creator-economy pool-distribution project.
- **Not designed for the "click to create your own pool" pattern.**
  The fiscal-host model fundamentally requires host approval per
  project. A general primitive where any tortok user spins up a pool
  in one click is incompatible with how fiscal hosts work.
- **Transparency-by-default is a feature but also a constraint.**
  All transactions public; fan anonymity not supported without host
  configuration.

**Stripe + USDC-on-Base (candidate 2) — blockers surfaced:**

- **"Stablecoin Payouts for Connect" is in private preview.** Self-
  serve application exists but production availability for a new
  platform is gated on Stripe approval. No public case studies of a
  creator-subscription-to-USDC flow at scale; tortok would be an
  early production reference.
- **Creator KYC is required (accepted as acceptable, 2026-04-17).**
  Payouts go to Stripe Connect Express accounts. Creators cannot
  onboard with just a Base wallet address — they must complete
  Stripe's identity / tax flow. Earlier drafts treated this as a
  wedge-breaking blocker on the "just a wallet" pitch. User
  decision: creator KYC is acceptable for V1 because (a) it's
  identical friction to Patreon/YouTube, (b) the wedge is "your
  videos, your followers, yours to take anywhere" — creators do
  *not* need the platform's permission to leave, which KYC doesn't
  compromise, (c) nothing prevents a later non-KYC rail (Lightning,
  direct wallet) from being added in parallel once the product is
  established.
- **Platform (tortok) must be US-incorporated today.** Stablecoin
  payouts are US-only on the platform side at 2026-04 availability.
  Incorporating tortok as a US entity is a decision that exists
  outside monetization and has its own implications (tax residency,
  legal exposure, US App Store entity requirements).
- **Effective fee is ~7.4% to creator.** $10 card payment yields
  ~$9.26 into creator's wallet: 2.9% + $0.30 card processing, plus
  1.5% stablecoin conversion. Competitive with Patreon (10–12%),
  worse than OC at scale (5–10%), materially worse than direct
  Lightning.
- **Chargeback asymmetry.** USDC leaves Stripe irrevocably; a fan
  chargeback 60 days later cannot claw funds back from the creator's
  wallet. Tortok eats the loss or pursues the creator off-platform.
  Operational policy required before launch.
- **Tortok does temporarily custody fiat.** Stripe holds the pool
  balance between collection and distribution. This is a softening
  of the "TorTok does not custody creator money" principle — not a
  violation if framed carefully ("custody is transient and
  contractual via Stripe") but needs to be made explicit and
  accepted, not quietly dropped.
- **Apple App Store Guideline 3.1.1 risk is real.** An in-app
  "support open content" subscription that ultimately unlocks or
  supports content on tortok is plausibly interpreted as an in-app
  purchase of digital content, requiring Apple IAP at 30%. No public
  precedent for this exact shape. Requires Apple written position
  before building; if Apple says IAP, the flow becomes web-only —
  which is compatible with a PWA-first launch but narrows the
  onboarding surface.

**Coinbase Commerce (fallback rail for crypto-native fans) —
ruled out.** Coinbase Commerce is shutting down March 31, 2026.

### Reconciliation

| Dimension                     | Open Collective        | Stripe + USDC/Base            |
|-------------------------------|------------------------|-------------------------------|
| Custody                       | Fiscal host custodies  | Stripe custodies transiently  |
| Automated distribution        | ❌ Manual per expense   | ✅ Programmatic                |
| Click-to-create-your-own-pool | ❌ Host approval required | ⚠️ Per-pool Stripe Connect    |
| Policy fit                    | Poor (OSC no, OCF risk) | Neutral (commercial rails)   |
| Creator onboarding friction   | Low (host handles it)  | KYC required (accepted)       |
| Fee stack                     | 5–10% host fee         | ~7.4% effective               |
| Platform risk                 | High (host solvency)   | Lower (Stripe is Stripe)      |
| Apple IAP risk                | Same                   | Same                          |
| Availability / gating         | Available, host-gated  | Private preview, US-only      |

With creator KYC accepted as V1 friction, **Stripe+USDC-on-Base is
the leading V1 rail.** OC loses on automation and platform risk.
Lightning (candidate 3) was not researched in this pass because its
small audience is well-understood; it remains a parallel optional
rail for crypto-native creators rather than a V1 primary candidate.

### V1 direction (recorded in ADR-011, 2026-04-17)

**Architect the payout layer behind an interface. Commit to the
first-party pool as a product. Defer the V1 rail commitment pending
two explicit prerequisites.**

ADR-011 in `decisions.md` is the authoritative record of the
decision. The summary below reflects what ADR-011 commits to.

1. The *interface* is the stable primitive. Sub-problem A's
   `tortok.payout.destination` Lexicon is the contract; which backend
   routes money per pool is an implementation detail. Ship the
   Lexicon even before any pool mechanism goes live — it unblocks
   external-destination linking (Patreon, LN address, URL) on day
   one.
2. The first-party "support open content" pool is a committed
   product surface, not a mechanism-bound feature. It can launch on
   any rail that satisfies the constraints.
3. **Prerequisite P1: Apple App Store written position on
   Guideline 3.1.1** for a fan-allocated PWYW pool that distributes
   to creators. If Apple confirms IAP applies, the pool is web-only
   for V1; native app ships the rail later or never.
4. **Prerequisite P2: Decide whether to incorporate tortok in the
   US.** This is a company decision (not a product decision) with
   implications beyond monetization. The Stripe+USDC rail requires
   it; the Lightning rail doesn't; the OC rail depends on the host's
   requirements.
5. After P1 and P2 resolve, the monetization ADR picks the V1 rail.
   Leading candidate is Stripe+USDC-on-Base, with explicit
   acceptance of: softened custody principle (transient Stripe
   float), creator KYC (accepted as acceptable friction), and a
   chargeback-asymmetry operational policy. Lightning runs as a
   parallel optional rail for crypto-native creators. OC is
   deprioritized due to automation and platform-risk blockers.
6. "Click to create your own pool" (Sub-problem B) is **V2, not V1**.
   Neither researched rail supports it cleanly. The general
   `tortok.payout.pool` primitive ships when there is a rail that
   supports per-pool instantiation without platform-level onboarding
   for each new pool.

**Other mechanisms discussed and where they land:**

- **Tipping (one-off).** Genuinely creator-aligned, complementary to
  the pool. Requires per-creator destination per Sub-problem A; with
  a fiscal host or Lightning, tortok still does not custody. Worth
  shipping as a parallel mechanism to the pool, not a replacement.
- **Premium creator features (tortok-side monetization).** Power-user
  features creators pay tortok directly for (e.g., higher-resolution
  uploads, longer videos, hosted seeder dashboards). Doesn't tax
  creators' fan revenue, gives tortok an income stream that doesn't
  depend on extracting from creators or running ads. Defer to its
  own decision; not blocking the release plan.

**Open sub-questions for the eventual ADR:**

1. Operating mechanism choice (1 vs 2 vs hybrid above).
2. Default fan behaviour if they don't manually allocate — split
   across all follows? Across recently-watched? Held until
   allocated? Refunded?
3. TorTok's cut: 0%, fixed-fee infrastructure cost, or opt-in
   "tip the platform" pattern?
4. Fan UX for picking creators — does it surface the creator's
   `tortok.payout.destination` records (Sub-problem A), or use a
   tortok-specific "in-pool" creator opt-in record?
5. Relationship to Sub-problem B's third-party pools — does the
   first-party pool count as one instance of the general pool
   primitive, or is it a different primitive?

**Dependency note.** Unlike the existing "external monetization"
philosophy, this PWYW pool model **does not strictly depend on
trustworthy view counts** (`view-counting.md`) for its primary
distribution mechanic — fan-allocated distribution sidesteps the
view-count trust problem. View counts remain critical for external
monetization but are no longer a prerequisite for shipping the pool.
This loosens the monetization-ADR sequencing.

## What the current architecture already supports

Confirming the philosophy-decided part doesn't need any new infra:

- **Profile records for external links** → already trivial with AT
  Protocol, just a field on the user record. Ship whenever.
- **Trustworthy view counts** → open problem, already tracked in
  `view-counting.md`. The resolve-by trigger is already "before
  monetization," which this file confirms.
- **No payment processor** → not needed, no ADR change required.
- **No KYC/PII separation** → not needed, the `monetization-PII`
  concern I flagged in an earlier draft of this file has been
  retracted.
- **No paid content gating** → not needed, ADR-008's R2+P2P model
  is untouched.
- **No ad serving** → not needed, not built, not planned.

## DMCA and copyright (shared with `moderation.md`)

Copyright hygiene is legally required regardless of monetization —
DMCA safe harbor needs a repeat-infringer policy and a takedown
pipeline. See `moderation.md`. Under external monetization, this is
*not* gated by a monetization launch (we're not paying creators, so
the "money flows → legal exposure escalates" argument is weaker),
but it's still required for v1 when we open signup.

## What a resolved version looks like

A resolved `monetization.md` splits into three (updated 2026-04-17):

1. **An ADR (or a small set of profile-record additions)** that
   ships the `tortok.payout.destination` lexicon and the baseline
   external-link surfacing (Sub-problem A). This unblocks creators
   monetizing off-platform on day one.
2. **A first-party-pool ADR** that picks an operating mechanism for
   the PWYW "support open content" pool (Sub-problem C), defines
   fan UX, and resolves the contradiction with the existing
   "TorTok does not operate the pool" principle. Likely the next
   monetization ADR after the inbound-federation work in ADR-010.
3. **A third-party-pool ADR** (possibly much later) that ships the
   `tortok.payout.pool` + `poolAcceptance` lexicons, the pool
   discovery UX, and the abuse/trust story (Sub-problem B). This
   one is optional — we can ship TorTok without it and add it when
   there's demand.

Sub-problem A and the external-monetization philosophy depend on
`view-counting.md` resolving first. **Sub-problem C does not** —
fan-allocated distribution sidesteps the view-count trust problem,
which loosens the sequencing on the first-party pool ADR.
