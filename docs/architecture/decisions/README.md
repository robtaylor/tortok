# Decisions

A decision record captures a choice worth understanding later: the context, the options considered, and the rationale for the one taken. It's the *why* behind a piece of the architecture. The *what the code does now* lives in the [architecture reference](../README.md), one doc per area. Each decision links forward to the area doc it shaped, and each area doc links back to the decisions behind it.

For the full convention, see [Claude Project Discipline — Decision records](https://robtaylor.github.io/claude-project-discipline/decisions.html).

## The rule: immutable and past-tense

A decision record is a record of a choice at the moment it was made, not a description of the system now. Its body is **never rewritten** when the code moves; edit the area doc instead. Only two lines change after acceptance: the `**Status:**` line and the `**Current architecture:**` forward-link.

When a decision itself changes, **write a new record that supersedes the old one**. Set the old one's status to `Superseded by Decision NNNN (YYYY-MM-DD)` and move it to [`archive/`](archive/):

```sh
uv run docs/scripts/doctool.py archive docs/architecture/decisions/NNNN-<name>.md
```

No dated `## Amendment` blocks. A change to *what the code does* is an area-doc edit; a change to *why* is a new decision.

## Three kinds of claim, aged differently

1. **Why the decision was made.** Past tense, as the state at decision time. Lives here, never rewritten.
2. **What the current architecture is.** Present tense, kept in step with the code. Lives in the area doc.
3. **What's decided but not built yet.** Lives in the area doc's `## Implementation status`, with a plan or issue, and drains into (2) as each piece lands.

Write all three in the same present tense and a reader can't tell *why we did it* from *what the code does* from *what we still intend*.

## Status legend

- **Proposed** — drafted, not yet ratified. Open the body with what the code does today, so the proposal can't be mistaken for reality.
- **Accepted (YYYY-MM-DD)** — the decision is in effect in the code.
- **Accepted (partial) (YYYY-MM-DD)** — ratified and partly built; the area doc's Implementation status says which parts.
- **Superseded by Decision NNNN (YYYY-MM-DD)** — replaced; lives in `archive/`.
- **Withdrawn (YYYY-MM-DD)** — abandoned without replacement; lives in `archive/`.

**Status must match the code.** A Status line is a claim about the codebase. Verify it against the implementation before setting it; don't trust the previous status or that a feature "shipped". Don't bump Proposed → Accepted just because a design merged.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-webtorrent-end-to-end.md) | Torrent engine is WebTorrent, end to end | Accepted (partial) |
| [0002](0002-atproto-federation.md) | Federation protocol is AT Protocol | Accepted (partial) |
| [0003](0003-identity-dids.md) | Identity uses DIDs — `did:plc` default, `did:web` opt-in | Accepted |
| [0004](0004-client-expo-react-native.md) | Client is Expo + React Native + TypeScript | Accepted |
| [0005](0005-backend-node-appview.md) | Backend stays Node + TypeScript; evolves into an AppView | Accepted (partial) |
| [0006](0006-migration-from-swift.md) | Migration path from the Swift prototype | Accepted |
| [0007](0007-signup-and-spam-prevention.md) | Signup UX and spam prevention | Accepted |
| [0008](0008-seeder-storage-cdn.md) | Seeder, storage, and CDN infrastructure | Accepted |
| [0009](0009-client-seeding-policy.md) | Phase 2 client seeding scope and policy | Accepted |
| [0010](0010-bluesky-video-bridge.md) | Bridge Bluesky video posts into the tortok feed (inbound federation) | Accepted (partial) |
| [0011](0011-monetization-architecture.md) | Monetization architecture — interface-first payout, first-party pool committed, V1 rail gated on Apple + US-incorporation prerequisites | Accepted (partial) |
| [0012](0012-lexicon-namespace.md) | Lexicon namespace governance | Accepted |
| [0013](0013-moderation-strategy.md) | Moderation strategy — atproto labelers, illegal-content floor, UK age-verification gate | Accepted (partial) |
| [0014](0014-device-testing-strategy.md) | Device testing strategy — self-hosted emulators for CI, real devices for video/P2P | Accepted (partial) |
| [0015](0015-tier3-p2p-testing-lambdatest.md) | Tier-3 real-device P2P testing runs on LambdaTest/TestMu | Accepted (partial) |
| [0016](0016-testing-strategy-where-each-kind-of-test-lives.md) | Testing strategy — where each kind of test lives | Accepted (partial) |
| [0017](0017-appview-postgres-is-a-rebuildable-index.md) | The AppView's Postgres is a rebuildable index, one of many | Accepted (partial) |
| [0018](0018-content-origin-mp4-webseeds.md) | Content origin is one MP4 per video on R2, served as a webseed; no origin seeder | Proposed |
| [0019](0019-v1-uses-existing-pds-via-oauth.md) | v1 uses each user's existing PDS through atproto OAuth; no custodial PDS | Accepted (partial) |
| [0020](0020-torrent-metadata-as-pds-blob.md) | Video posts carry their torrent metadata as a PDS blob | Accepted (partial) |
| [0021](0021-e2e-on-hosted-runners.md) | End-to-end tests run on GitHub-hosted runners against a throwaway local stack | Accepted (partial) |

Forward-looking items that are **not yet decisions** — unresolved design problems, deferred decisions, and explicit out-of-scope — live in [`../open-problems/`](../open-problems/README.md), a tortok-specific extension to the stock discipline (each entry carries a phase-gated `Must resolve by` header). `uv run docs/scripts/doctool.py lint` checks this table against the decision files.

## Adding a new decision

```sh
uv run docs/scripts/doctool.py new decision "Short title"
```

That copies `0000-template.md` to the next free number and adds the index row. The four-digit number is a stable ID, cited as "Decision NNNN" from docs, code, and commits. Never reuse or renumber it, including after a record moves to `archive/`. Then add the `**Current architecture:**` link to the area doc this decision shapes, and a link back from that area doc's "Decisions behind this" section.
