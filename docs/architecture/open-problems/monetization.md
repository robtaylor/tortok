# Open problem: Monetization

**Status:** Philosophy decided. Implementation sub-problems open.
**Must resolve by:** Before any pool→payout feature is announced or
shipped. The baseline external-monetization model does not need any
new architecture beyond trustworthy view counts.
**Blocks:** Pool→payout lexicon work; any in-app surfacing of
creator payout destinations.
**Related ADRs:** ADR-002 (AT Protocol + Lexicons), ADR-005 (own PDS
+ AppView). Depends on `view-counting.md`.

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

A resolved `monetization.md` splits into two:

1. **An ADR (or a small set of profile-record additions)** that
   ships the `tortok.payout.destination` lexicon and the baseline
   external-link surfacing. This unblocks creators monetizing off-
   platform on day one.
2. **A second ADR** (possibly much later) that ships the
   `tortok.payout.pool` + `poolAcceptance` lexicons, the pool
   discovery UX, and the abuse/trust story. This one is optional —
   we can ship TorTok without it and add it when there's demand.

Both depend on `view-counting.md` resolving first, because both hinge
on engagement numbers creators and pools can actually trust.
