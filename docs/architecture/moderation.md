# Moderation

*Reference doc — **stub.** The full present-tense write-up of moderation (the
atproto labeler integration, the illegal-content floor, the UK age-verification
gate, DMCA handling) is pending the post-migration area-doc backfill, which
checks every claim against the code. The decision record below is authoritative
for the design.*

This area covers how tortok moderates: atproto labelers end-to-end, a mandatory
illegal-content floor (CSAM hashing, DMCA agent), and a UK Online Safety Act
age-verification gate.

## Implementation status

None of it is implemented: there is no labeler subscription, CSAM hashing, DMCA
agent or age gate in the code. Decision 0013 sets the strategy; its "Phase 3
signup-beyond-team launch criteria" section and the launch criteria in
[`release-plan.md`](../plans/release-plan.md) make the labeler integration and
the illegal-content floor launch-blocking.

## Decisions behind this

- [Decision 0013 — Moderation strategy (labelers, illegal-content floor, UK age gate)](decisions/0013-moderation-strategy.md)
