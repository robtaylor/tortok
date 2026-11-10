# Decision 0011: Monetization architecture — interface-first payout, first-party pool committed, V1 rail gated on Apple + US-incorporation prerequisites

**Current architecture:** [Monetization](../monetization.md)

**Status:** Accepted (partial) (2026-04-17). NSIDs set by [Decision 0012](0012-lexicon-namespace.md) (2026-04-29).

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
   primitive is Sub-problem A's `app.tortok.payout.destination` Lexicon
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
   sequencing on this decision.

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
   discussion; this decision only notes that the leading V1 rail depends
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
   `app.tortok.payout.pool` Lexicon ships when there is a rail that
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

11. **Sequencing.** Sub-problem A (the `app.tortok.payout.destination`
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
  locked to a rail. The `app.tortok.payout.destination` Lexicon can
  land in Phase 3 alongside the PDS work with no rail commitment.
- The release-plan Phase C ("App Store/Play 1.0 promotion, triggered
  by readiness or catalyst") acquires a hard dependency on
  Prerequisite P1. A native pool flow cannot ship on iOS without
  Apple's position. If Apple forces web-only, the App Store launch
  is still possible — the pool simply lives in the PWA surface.
- Creator KYC becomes a documented V1 requirement for the first-
  party pool. Creators who want to receive from the pool complete
  Stripe Connect Express onboarding (identity + tax). Earlier drafts
  framed this as wedge-breaking; this decision records that it is not —
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
  Decision 0013's labeler/queue capacity but does not block this decision.
- Sub-problem B ("click to create your own pool") being V2 softens
  the federation pitch slightly — third parties can still run pools
  via the Lexicon, but tortok won't surface them. Revisit when the
  rail situation allows.

**Alternatives ruled out.**

- **Pick a rail now and write the decision around it.** Tempting but
  premature: neither researched rail is fully knowable without
  Apple's position (P1) and the US-incorporation decision (P2).
  Writing the decision around Stripe+USDC today forces commitment to
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
  Contradicts Decision 0007's "frictionless familiar signup."
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

- `app.tortok.payout.destination` Lexicon design work: Phase 3,
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
