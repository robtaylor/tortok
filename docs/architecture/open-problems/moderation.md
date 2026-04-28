# Open problem: Content moderation

**Status:** Unresolved. Sketch only.
**Must resolve by:** Phase 3 — before signup opens to anyone outside
the team. The auth source is now the user's existing PDS (typically
`bsky.social`, per the 2026-04-29 amendments to ADR-003 and ADR-007),
but we still curate the TorTok feed and own AppView-layer moderation.
Shipping moderation after real users arrive is strictly harder than
shipping it before.
**Blocks:** opening signup beyond invite list.
**Related ADRs:** ADR-005 (AppView), ADR-007 (signup UX and AppView-
layer abuse escalation ladder, as amended 2026-04-29).
**Related open problems:** `monetization.md` (see the DMCA note
below; copyright hygiene is not gated by monetization launch under
the external-monetization model, but it's still a v1 requirement).

## The problem

TorTok is a federated video platform with user-generated content. We
need a workable answer to each of the following before strangers can
upload:

- **Illegal content** (CSAM, direct-violence incitement, copyright
  strikes). Legal obligation, reputational risk, no wiggle room.
- **Policy-violating content** (nudity in a non-NSFW context, hate
  speech, harassment, spam). Policy choices; we have to make them.
- **Federation-propagated content.** Because we federate via AT
  Protocol, content we accept may be replicated into other AppViews
  before we label or remove it. The window between publication and
  removal is the failure window.
- **Appeals and mistakes.** Any moderation system will take down
  legitimate content. We need a reversal path that doesn't require
  engineering tickets.

## Sketch: three-tier approach

This is a starting point, not a decision. It's the pattern PeerTube
and Mastodon operators converged on, adapted for our stack.

**Tier 1 — automated signal at upload.**
- Server-side NSFW classifier (e.g., open-source NSFWJS or a managed
  API) on thumbnail + sampled frames. Threshold to investigate:
  `>0.7` confidence auto-labels as NSFW and hides from default feed;
  `>0.95` auto-holds for review.
- Perceptual hash comparison against a blocklist for known illegal
  content (PhotoDNA if accessible; open-source alternatives otherwise).
- Caption/hashtag keyword filters for the obvious stuff.
- None of these are sufficient alone; all of them are cheap enough
  to run on every upload.

**Tier 2 — user reporting with auto-hide threshold.**
- Any authenticated user can report a post. Reports include a reason
  category (spam / nudity / harassment / illegal / other).
- Post auto-hides (not deletes) at **3 distinct reports from
  accounts older than 7 days**. Hiding is reversible; deletion isn't.
- Hidden posts enter a moderation queue for human review.
- False reporting is itself abuse; repeat false reporters get their
  report weight reduced (soft shadow-ban of the report signal).

**Tier 3 — shared community blocklists.**
- Subscribe to fediverse-style blocklists (e.g., the `fediblock.org`
  convention, if it still exists in 2026) at the instance level for
  known-bad domains and accounts.
- AT Protocol labelers are the native mechanism here — we can both
  consume external labelers and run our own. ADR-007's escalation
  ladder already mentions building our own labeler if abuse warrants.

## DMCA and copyright (v1 requirement, not gated by monetization)

Copyright hygiene is a v1 requirement regardless of whether TorTok
pays creators. DMCA safe harbor (in the US) requires:

- A designated DMCA agent registered with the Copyright Office
- A published takedown process with a form or email address
- A repeat-infringer policy that actually terminates repeat offenders
- Good-faith response to valid takedown notices within a reasonable
  window (customarily 24–72 hours)

Under the external-monetization model (see `monetization.md`),
TorTok does not pay creators directly — so the "money flows to
creators → legal exposure escalates" argument is weaker than it
would be for a platform running its own creator fund. That softens
the urgency but does not eliminate it: hosting user-uploaded video
with federation makes us a distributor, and distributors need
takedown machinery.

**What needs to exist before Phase 3 opens signup:**
- A takedown endpoint and a human who reads it
- A repeat-infringer counter (three strikes → account suspension is
  the standard pattern)
- A deletion-propagation test showing we can remove content from our
  PDS and observe it disappearing from federated AppViews
- A published content policy and DMCA contact page

Content ID systems (automated fingerprint matching against a
copyright-holder database) are massively expensive and firmly out of
scope for v1. We respond to takedowns; we do not proactively scan.

## Unresolved sub-questions

1. **Who reviews the Tier 2 queue?** For v1 it's probably us (the
   team). After that: paid moderators? Volunteer mods per community?
   How does the queue scale past the team's bandwidth?
2. **Federation propagation lag.** If we remove a post, how do we
   propagate the removal to AppViews that already indexed it? AT
   Protocol's deletion semantics exist but the practical latency
   and coverage need to be measured.
3. **Appeals UX.** A user whose post was auto-hidden needs to see
   *that* it was hidden, *why*, and how to appeal. None of this is
   designed.
4. **NSFW-as-category vs NSFW-as-violation.** Lots of adult creators
   want a home for legal adult content. Do we allow that behind an
   age gate, or is TorTok SFW-only? This is a product decision with
   significant policy consequences.
5. **Who gets to see reports?** Privacy of the reporter matters; so
   does accountability. Mastodon has scars from both directions.
6. **Legal jurisdiction.** Where is TorTok Inc. incorporated, and
   what law governs content removal? This isn't a code problem but
   it shapes the policy.

## What a resolved version looks like

A working resolution is an ADR that says:
- Which Tier 1 classifier we use and at what thresholds
- Concrete numbers for Tier 2 (N reports, M-day account age, K-hour
  review SLA)
- Who operates the moderation queue at what scale
- A written content policy users can read before signing up
- An appeals flow designed end to end
- A deletion propagation test showing we can remove a post from our
  PDS and observe it disappearing from one external AppView

Anything less than that and Phase 3 shouldn't open signup.
