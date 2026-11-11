# Open problem: View counting and creator monetization

**Status:** Unresolved. Problem statement + six candidate approaches.
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
problem is load-bearing); `signed-out-feed.md` (whether views can come
from people who haven't signed in).

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

These are six genuinely different designs. Each has known failure
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

### 5. Show no view counts

Count views privately for ranking, show creators their own numbers, and
publish nothing. This is what Bluesky does (see below).

**Pros.** No public number to game, no trust question for other AppViews.

**Cons.** Gives creators nothing third parties can rely on, which breaks
the external-sponsorship model in `monetization.md`. Viable only if
monetization stops depending on views.

### 6. Anonymous view tokens

Make views as verifiable as likes without revealing who watched, using
anonymous tokens, the pattern behind Privacy Pass (IETF RFCs 9576–9578).

1. An issuer gives each logged-in account a capped batch of view tokens
   (say N per day). The issuer knows which account received tokens, but
   blind signatures stop it recognising them later.
2. When the client counts a view, it spends one token tagged with the
   post's at-uri. No DID is attached. The issuer's signature proves the
   token is genuine.
3. Spent tokens are published. They identify nobody, so any AppView or
   funder can recount a post's views, verify every signature and reject
   double-spends.

The transport can be `sendInteractions` (see below) with a tortok event
such as `#interactionWatched` carrying the token instead of the caller's
DID. Clients spend tokens in batches at random delays, so timing can't link
a token to the IP address that fetched the video. Approach 2's
chunk-download proof can ride inside the token, so a token proves bytes
were received as well as that an account existed.

Tokens prove a real *account*, not a real *person*. That puts views at the
same level as likes and as fake-account resistance on Instagram or TikTok,
which is an acceptable target. The atproto-specific difference is that
anyone can run a PDS and mint accounts without any signup friction, so the
defence sits in issuance policy: which accounts get tokens, and how many.
Options include caps per PDS host, account age or activity, labels from
trusted labelers (Decision 0013), and full allowances only for hosts with
real signup checks.

Counting becomes a choice made by whoever consumes the count. Because spent
tokens are public, a funder (an external sponsor, or the fan pool of
Decision 0011) recounts under its own trust policy, for example accepting
only tokens from `bsky.social` and hosts it has vetted. To make that
possible after spending, the issuer signs with a separate key per trust
tier, and a funder chooses which keys it accepts. Tiers, not per-host keys:
a small host with its own key would shrink its users' anonymity set to a
handful of people.

Volume is the main unsolved cost. A publicly verifiable token is roughly
300 bytes (mostly an RSA-2048 signature), so 100k daily users watching 50
videos each spend 5M tokens, about 1.5 GB, a day. Storing that is cheap
(a few dollars a month per year of logs on R2). Verifying it all is not, so
the design avoids anyone having to:

- Shard the published log by post, so a funder fetches only the posts it
  pays on.
- Rotate issuer keys per epoch (e.g. daily). A token is valid only in its
  epoch, so double-spend checks cover one epoch's set and old epochs can be
  archived.
- Publish per-post counts and a Merkle root per epoch. Auditors check
  random samples with inclusion proofs, which catches inflation with high
  probability; anyone wanting certainty fetches a post's full shard.

The log format, where it is published, and how auditors fetch a shard are
still open.

A hosted service that sells funders verified stats from these logs is a
possible tortok income stream; see "Other mechanisms" in
[`monetization.md`](monetization.md).

**Pros.** Meets the privacy, verifiability and decentralisation
constraints together. Each funder sets its own trust policy instead of
trusting tortok's number. Builds on standardised cryptography.

**Cons.** Issuers are trusted not to mint tokens for accounts they
invented (several issuers, or PDS-run issuance, spread that trust). A
blind-signature issuer is a new service to run. The issuance policy is
real anti-abuse work, the same work Bluesky's AppView does for likes and
replies.

## Prior art in AT Protocol (checked 2026-11-09)

Bluesky has no view counts anywhere in the protocol. A post view
(`app.bsky.feed.defs#postView`) carries like, reply, repost, quote and
bookmark counts. The video embed's view (`app.bsky.embed.video#view`)
carries the playlist, thumbnail, alt text, aspect ratio and presentation,
and no counter.

What it does have is a standard way for a client to report what a user saw.
`app.bsky.feed.sendInteractions` sends batches of events to "the feed
generator that served them", and a feed generator opts in with
`acceptsInteractions`. The events include `interactionSeen` ("Feed item was
seen by user"), the clickthrough events, like, repost, reply, quote, share,
and `requestMore`/`requestLess`. The data goes only to that feed generator
and is never published.

That is ready-made plumbing for approach 1. Three points apply:

- Calls to a feed generator normally go through the user's PDS, which
  attaches a service-auth token naming the user's DID. If `sendInteractions`
  is authenticated that way, each event comes from a real account rather
  than an anonymous device, which is the basis for per-DID rate limits.
  Not yet verified.
- `interactionSeen` means the item appeared on screen, not that it was
  watched. The event field's values are a known-values list, not a closed
  set, so tortok can add its own, e.g. `app.tortok.feed.defs#interactionWatched`
  with the watched duration.
- The counts still live on one AppView, as operator-local data under
  Decision 0017, so other AppViews must trust them. The transport doesn't
  change the trust model; approaches 2 and 3 could use it to carry proofs.

Likes show why views are harder. A like is an `app.bsky.feed.like` record in
the liker's own repo, signed by their key, and a like count is an AppView
counting those records. Anyone can recount and check each one, so like
counts are verifiable. They aren't Sybil-resistant: a signature proves an
account liked the post, not that a person did, and AppViews filter
differently (takedowns, labels, blocks), so honest AppViews can disagree.
Views can't copy this design, because a public record per view would
publish every user's watch history. That is why views end up as private,
trusted data unless approach 2 or 3 makes them provable without revealing
who watched.

## Current leaning (2026-11-09)

Not a decision. Approach 6 is the target, because it is the only candidate
that meets the privacy, verifiability and decentralisation constraints
together. It is not the first step:

- **Now through Phase 4: approach 1.** Clients report through
  `sendInteractions` with a tortok `#interactionWatched` event. Counts stay
  private and serve ranking and creators' own dashboards. Shape the event
  so a token field can be added without a new format.
- **Before money depends on counts: an approach-6 spike.** It covers the
  verification-volume design above, a blind-signature library on Hermes
  and the web build, batched delayed spending on backgrounded phones, and
  per-host issuance policy. Decision 0011 gates payouts on other questions
  anyway, so this is not on the Phase 3 or 4 critical path.
- **Fallback: approach 5** if monetization stops depending on views.

Approaches 2 and 3 become ingredients of 6 (a download proof inside the
token) rather than alternatives. Approach 4 stays parked.

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
   approaches 1–4 and 6 need a minimum-watch-threshold story.
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
