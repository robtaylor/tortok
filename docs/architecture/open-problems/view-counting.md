# Open problem: View counting and creator monetization

**Status:** Unresolved. Problem statement + four candidate approaches.
**Must resolve by:** Phase 4 AppView cutover if the feed ranks on
views. Under the external-monetization model decided in
`monetization.md`, this is *the* signal TorTok provides to creators
so they can sell external sponsorships — weak view counts don't mean
weak monetization, they mean no monetization, because creators can't
sell deals on numbers nobody trusts. Treat this as load-bearing.
**Blocks:** any feed ranking that uses views; any creator's ability
to negotiate external sponsorships using our numbers; any federated
pool→payout formula that distributes by view share.
**Related decision records:** Decision 0002 (AT Protocol federation), Decision 0005 (AppView).
**Related open problems:** `monetization.md` (the central reason this
problem is load-bearing).

## The problem

In a P2P video platform, view data flows peer-to-peer — not through
a server that can count them. A trustworthy view count has to satisfy
several adversarial constraints simultaneously:

- **Fraud resistance.** Fake views, botting, Sybil attacks. If views
  are load-bearing for ranking or payment, the incentive to cheat is
  proportional to the reward.
- **Privacy.** We should not reveal what individual users watch.
  "User X viewed video Y at timestamp Z" is not data we want to hold,
  and definitely not data we want to federate.
- **Decentralization.** No single-point-of-truth counter. If we rely
  on our AppView as the authoritative counter, we've reintroduced the
  central-authority failure mode AT Protocol was supposed to avoid.
- **Scalability.** Millions of views per day at steady state. Cost
  per view must be fractions of a cent.
- **Verifiability.** Anyone should be able to audit the aggregate
  count, even if they can't see individual events.
- **Mobile constraints.** Clients are phones that spend most of their
  time in background or offline. Any scheme requiring always-on
  client cooperation is dead on arrival.

## Candidate approaches

These are four genuinely different designs. Each has known failure
modes; we need to pick one (or a hybrid) with eyes open.

### 1. Server-side attestation with heuristics (simplest)

Client emits a signed "I watched this" event to our AppView. Server
counts. Heuristics filter obvious fraud.

- **Minimum watch threshold:** event only counted if `watchedMs ≥
  3000` (3 seconds).
- **Per-user per-video rate limit:** 1 view per user per video per
  hour.
- **Per-IP rate limit:** cap total views per IP per minute.
- **Account-age filter:** views from accounts younger than 24 hours
  carry reduced weight.

**Pros.** Dead simple. Cheap. Easy to tune. Same pattern every major
platform uses under the hood.

**Cons.** We are the counter. If we say a view happened, the network
has to trust us. Federation partners get a count from our AppView and
can't verify it independently. Creators have no recourse if they
suspect we're gaming the numbers.

### 2. Cryptographic chunk-download proof

Client proves it actually downloaded enough of the video's BitTorrent
chunks to count as a view. The proof is a signed statement: "I have
pieces 0–N of infohash X, timestamp Y."

- **Threshold:** 80% of chunks downloaded within the expected
  duration window counts as a view.
- **Freshness:** proof is valid for 5 minutes, so a single proof
  can't be replayed indefinitely.
- **Aggregation:** our AppView collects proofs and publishes a
  Merkle root of the view set; anyone can verify a view is in the
  set.

**Pros.** Actually connects "view" to "bytes received." Hard to fake
without doing the bandwidth work. Verifiable.

**Cons.** Complexity. A user can still run N headless clients. The
chunk proof verifies bandwidth, not intent.

### 3. Swarm attestation

Peers in the WebTorrent swarm attest to each other's participation.
If five independent peers say "yes, this peer pulled pieces from me,"
that's a view.

- **Quorum:** N peer signatures required (N = 3–5 depending on swarm
  size).
- **Sybil resistance:** peer identity has to be tied to something
  harder to fake than a random keypair. **Unresolved.** Without this,
  swarm attestation collapses to "an attacker spins up N peers of
  their own and attests to themselves."

**Pros.** Fully decentralized. No trusted counter.

**Cons.** Sybil risk is load-bearing and unsolved. This approach is
unsafe until we have a credible Sybil-resistance answer, which
probably means tying peer identity to the atproto DID + rotation key,
which means custodial accounts (Decision 0003) weaken the property. Deferred.

### 4. Blockchain settlement layer

Views get logged as transactions on a cheap L2 chain; counts are
derivable from chain state; creator payments settle directly from
the same state.

**Pros.** Auditability by construction.

**Cons.** Adds a chain to our stack. Premature. If monetization
becomes the product, this deserves a real evaluation — but not now.
Documented only so future-us doesn't forget it was on the table.

## Economic calibration

For reference, YouTube's effective creator rate is roughly
**$0.001 per view** (varies wildly by niche, ad fill, and
geography). Any payment system we design has to be comfortable at
that rate — cheaper is fine, more expensive means the numbers don't
work without platform-side subsidy.

Engagement-weighted alternatives to raw view counts:
- 40% watch completion
- 30% like
- 20% share
- 10% comment

These weights are a starting point, not a decision.

## Attack vectors we have to answer for

1. **View botting.** Headless clients looping a video. Mitigation:
   all four approaches need a minimum-watch-threshold story.
2. **Peer collusion.** Two accounts pull pieces from each other and
   attest to each other's views. Breaks approach 3.
3. **Replay attacks.** Same signed proof submitted N times. Mitigation:
   nonce + freshness window.
4. **Creator self-views.** Creator pays themselves. Mitigation: reject
   views from the publisher's own DID.
5. **Sybil fleet.** One operator runs 10k cheap accounts. Approaches
   1, 2, and 3 all break here without account-creation friction; that
   friction is Decision 0007's job.

## Unresolved sub-questions

1. **Privacy vs fraud trade-off.** Stronger fraud detection usually
   means more per-user telemetry. Where's the line?
2. **Minimum payout threshold.** Before we pay anyone, the per-view
   economics and the per-payout overhead have to close. Unknown.
3. **Instance operator trust model.** If TorTok federates with
   third-party AppViews, do we trust their view counts or only our
   own? Affects approach 1 significantly.
4. **Governance.** Who arbitrates disputes when a creator claims
   their views were undercounted?
5. **Which chain (if approach 4).** Deferred until approach 4 is
   actually on the table.

## What a resolved version looks like

A decision record that:
- Picks one primary approach (or a hybrid) with explicit trade-offs
- States the watch-threshold, rate-limit, and eligibility numbers
- States whether views are federated or local
- Answers the five attack vectors above
- Either enables feed ranking on views, enables creator payments, or
  explicitly states "views are display-only for now and we'll revisit
  before they become load-bearing"
