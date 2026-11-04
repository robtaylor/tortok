# ADR-013: Moderation strategy — atproto labelers, illegal-content floor, UK age-verification gate

**Status:** Accepted — 2026-04-29. Resolves
`docs/architecture/open-problems/moderation.md`.

**Context.** Phase 3 opens signup (eventually); content moderation has
to be in place before that window opens to anyone outside the team.
Three forces shape the answer:

1. **Federation.** Content lives on user PDSes (typically
   `bsky.social`). We curate at the AppView. We can refuse to index,
   but we can't delete records on PDSes we don't operate.
2. **User-controlled visibility.** TorTok's stance is that what a user
   sees is decided at the user end, not platform-imposed by default.
   The platform's role is to surface signals (labels), not to enforce
   one viewing policy on everyone.
3. **UK Online Safety Act.** TorTok is, or will be, UK-incorporated
   (per the working ADR-011 P2 assumption). The OSA applies fully:
   illegal-content duties, "highly effective" age assurance for
   pornographic content, and reporting/transparency obligations
   scaling with user count.

The open-problem doc sketched a three-tier approach (auto signal at
upload, user reports with auto-hide, community blocklists). atproto
already has a primitive that unifies all three: **labelers**. This
ADR adopts the labeler model end-to-end and adds the unavoidable
platform-level layers (illegal-content floor, DMCA, OSA compliance)
on top.

The guiding principle is **indirect to atproto and Bluesky standards
wherever they exist**. We do not invent moderation primitives if the
protocol or its reference implementations already provide them.

**Decision.**

The strategy is structured as three layers: what we *adopt* from
atproto, what we *adopt* from Bluesky's reference implementations,
and what we *add* on top because it isn't in the protocol.

### Adopted from atproto

1. **Labelers are the primary moderation primitive.** A label is a
   signed assertion that a record (or account) has some property
   (e.g., NSFW, spam, suspended). Labels do not remove content; they
   annotate it. Clients filter based on the user's labeler
   subscriptions and per-label preferences (`hide` / `warn` / `ignore`).

2. **Composable label streams.** A user subscribes to multiple
   labelers; their effective filter is the composition. We run one
   first-party labeler; users can subscribe to additional ones
   (Bluesky's defaults, community-run, etc.).

3. **Deletion semantics for native records.** When we determine a
   record must be removed (illegal content, repeat DMCA infringer),
   we refuse to index in our AppView. The author's PDS is asked to
   delete the record per the standard atproto delete-record op; we
   do not have authority to delete remotely but we can submit a
   takedown request to the home PDS. PDS cooperation is best-effort
   (point 7 below).

### Adopted from Bluesky's reference implementations

4. **Default labeler subscription set.** Every TorTok client
   subscribes by default to the same labeler set Bluesky's first-
   party app subscribes to (CSAM hash matching, etc.). This gives us
   protocol-floor moderation for free at v1 and avoids reinventing
   perceptual-hash infrastructure. ADR-010 already made this
   commitment for bridged content; we extend it to native content.

5. **Ozone for our first-party labeler operations.** Ozone is
   Bluesky's open-source moderation tool — the same software they
   run for their own labeler. We adopt it (or fork it) rather than
   building our own queue/UI from scratch. v1 may use lighter ad-hoc
   tooling for the small invite-only window; Phase 4 cuts over to
   Ozone.

6. **Appeals UX patterns.** When a user's content is hidden, they
   see *that* it was hidden, *why* (which label was applied), and
   how to appeal. We match Bluesky's appeals patterns where
   applicable; v1 appeals are email; Phase 4 in-app.

### Added on top (not in the protocol)

7. **Illegal-content floor.** Labelers are not optional for: CSAM,
   credible incitement to violence, and material under valid DMCA
   takedown. These categories are removed from the TorTok AppView
   regardless of any user's labeler preferences. We refuse to index
   the record and (for CSAM/illegal) report to the home PDS for
   action. Cross-PDS takedown cooperation via
   `com.atproto.admin.*` is best-effort — we cannot guarantee a
   third-party PDS honours our request, but we can guarantee the
   record never appears in our AppView.

8. **DMCA compliance.** Required for US safe harbor regardless of
   incorporation jurisdiction (we accept US users):
   - Designated DMCA agent registered with the US Copyright Office
     (legal task, **blocking before Phase 3 opens signup beyond
     team**).
   - Takedown endpoint at a published URL (`dmca@tortok.app` or
     equivalent web form).
   - Repeat-infringer policy: 3 strikes within 12 months → permanent
     suspension from our AppView indexing (record on user's PDS
     persists; we just don't show it). Threshold revisited once we
     have a critical mass of content providers and can calibrate
     against real strike-rate data.

9. **UK Online Safety Act compliance.** Required because we are (or
   will be) UK-incorporated:
   - Named senior manager responsible for OSA compliance.
   - Published content policy and reporting flow.
   - Risk assessment and transparency reporting (lightweight at v1
     scale; scales with user count thresholds).
   - **Highly effective age assurance** for pornographic content
     (point 11 below).

10. **Our first-party labeler operates the Tier 1/Tier 2 inputs.**
    Three input streams collapse into label assertions on records:
    - **Automated classifier (Tier 1).** NSFWJS server-side on
      thumbnail + sampled frames. Confidence `>0.7` attaches the
      `nsfw` label; `>0.95` queues for human review. Replaceable
      with managed (Hive, AWS Rekognition) if false-positive rate
      is bad.
    - **User reports (Tier 2).** Any authenticated user can report
      a record. 3 distinct reports from accounts older than 7 days
      attach a tentative `reported` label and queue for review.
      24-hour team SLA at v1 (escalates with volume).
    - **Manual review (Tier 3).** The team confirms or removes
      labels, applies `suspended` to repeat offenders, refers
      illegal content to the floor (point 7).

11. **NSFW visibility = labeler + UK age-verification gate.** All
    users start with NSFW labels enforced (content hidden by default).
    Toggling NSFW visibility off:
    - **Non-UK users.** Self-attestation; one-tap toggle. Geo-
      detection by IP. Multi-jurisdiction age-verification
      (other countries adopting OSA-equivalents) is a future
      amendment, not v1 scope.
    - **UK users.** Must complete "highly effective" age
      verification via a third-party provider (Veriff,
      AgeVerifyUK, or KWS — provider choice deferred; pricing
      target ≤£1/check). Result cached per account, refresh
      policy TBD with the provider's compliance team.
    - **Verification is one-time** (per account, per refresh
      window). Geo-gated so non-UK users do not pay verification
      friction.

12. **Community moderation as the scale answer.**
    - **v1.** TorTok team operates the queue. Invite-only signup
      caps the volume.
    - **v2.** Vetted community moderators operate sub-labelers
      under our umbrella. Composes with the first-party labeler.
    - **v3.** Community-run independent labelers in the open
      atproto ecosystem; we surface popular ones as in-app
      recommendations.
    - AI tooling (Ozone's automod features + our classifiers)
      handles the long tail at every stage.

### Phase 3 signup-beyond-team launch criteria

Signup remains invite-only until **all** of:
- Tier 1 NSFWJS classifier deployed in the upload pipeline.
- Bluesky default labelers subscribed by every TorTok client.
- DMCA agent registered with the US Copyright Office.
- Takedown endpoint live and monitored.
- Content policy published.
- UK age-verification provider integrated and geo-gating live.
- Federation deletion-propagation test passing: a record deleted on
  one PDS observed disappearing from at least one external AppView
  within an SLA window.
- OSA-named senior manager designated.

**Consequences.**

- Visibility is user-controlled by design. We do not become the
  arbiter of what UK or non-UK users see beyond the illegal-content
  floor and OSA-mandated NSFW gate.
- We accept ongoing operational cost: human review (~24h SLA),
  Ozone hosting, classifier compute, age-verification per-check
  fees. None of these are large at v1 scale; all grow with users.
- DMCA agent registration becomes a tracked legal action item with
  a hard dependency on Phase 3 signup launch. Lead time is 1–2
  weeks; start in parallel with this ADR landing.
- UK age-verification provider integration is a Phase 3.5 item with
  per-check cost (~£0.20–£1) that scales with the fraction of UK
  users toggling NSFW on. Negligible at invite scale; budgeted
  before open signup.
- Federation deletion-propagation test is added to Phase 3's
  acceptance criteria. It requires we control or have a friendly
  external AppView to test against; coordinate with one of the
  community-run AppViews if any are reachable.
- We become a downstream consumer of Bluesky's labeler ecosystem.
  If Bluesky's default labelers degrade or change behaviour, our
  protocol-floor moderation degrades with it. Mitigated by the
  labeler set being public and replaceable; we can add or
  substitute.
- The "moderation queue at scale" question is bounded but not
  solved — v1 is team-only, with v2/v3 paths mapped. Concrete
  trigger to hire/contract paid moderators: ≥50 reports/day
  sustained for 14 days (TBD, adjustable).
- Multi-jurisdiction age-verification (non-UK countries that adopt
  OSA-equivalents) is explicitly deferred. The geo-gating
  infrastructure built for the UK case generalises, but adding new
  jurisdictions is a future amendment, not v1 scope.

**Alternatives ruled out.**

- **Platform-imposed default visibility (Tier 2 sketch's "auto-
  hide").** Contradicts the user-control stance. Auto-hide for
  illegal content stays; auto-hide for legal-but-controversial is
  rejected in favour of label-and-let-user-filter.
- **Build our own moderation queue/UI from scratch.** Ozone exists,
  is open source, is what Bluesky runs, and supports the labeler
  abstraction natively. Building our own is wasted effort.
- **Pre-emptive Content ID / fingerprint matching.** Multi-million-
  dollar systems (YouTube-scale). Not required for DMCA safe harbor.
  Out of scope for v1; respond to takedowns reactively.
- **Self-attestation only for UK NSFW gating.** Online Safety Act
  explicitly requires "highly effective" age assurance. Self-
  attestation does not qualify. Documented Ofcom guidance.
- **Geo-block UK to avoid OSA.** UK is the home market and the
  founder's residence. Not viable.
- **Three-tier moderation as separate systems.** The open-problem
  doc's tiers conflate input source with output mechanism. Rolling
  them up under the labeler abstraction (point 10) is cleaner —
  all three are *inputs* to the same first-party labeler.
- **Defer DMCA registration to post-launch.** Hosting user-uploaded
  video without a registered agent risks losing safe-harbor
  protections from day one. Not a "deal with it later" item.

**Implementation notes.**

- **Tier 1 classifier defaults.** NSFWJS, server-side, thumbnail +
  3 sampled frames. Thresholds 0.7 (label) / 0.95 (auto-hold).
  Replaceable in config without code change.
- **Tier 2 defaults.** N=3 reports, M=7 days account age, K=24-hour
  team review SLA. False-reporter weight reduction after 5 dismissed
  reports.
- **Reporter privacy.** Confidential by default (Mastodon-flavored).
  Reported users see "this content was reported" without the
  reporter's identity. Mod team sees identity for triage; never
  disclosed externally. Revisitable if abuse-reporting itself
  becomes weaponized.
- **Adult-content category.** v1: SFW-only-by-default with NSFW
  labeler enforced for all unverified users. Adult-content creators
  may post; their content carries the NSFW label and is hidden
  unless the viewer has toggled off the label (UK: behind age
  verification). Following Bluesky's precedent of allowing adult
  content behind the gate rather than banning the category.
- **Age-verification provider.** Veriff vs AgeVerifyUK vs KWS
  comparison is its own task. Goal: ≤£1/check, 1-year cache window,
  Ofcom-recognised method.
- **Ozone v1 vs v2.** Phase 3 invite-only window may use ad-hoc
  tooling (a queue table + a small admin UI). Phase 4 cuts over to
  Ozone proper.

**Open sub-questions deferred (do not block this ADR):**
- Specific age-verification provider (provider-comparison task).
- Exact Ozone deployment shape (Phase 4 question).
- Trigger thresholds for hiring paid moderators (operational; tune
  as data arrives).
- Multi-jurisdiction age-verification expansion as other countries
  pass OSA-equivalents.
