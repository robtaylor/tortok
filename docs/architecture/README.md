# Architecture

The current design of tortok, by area. Each area is a **reference** doc: what the code does today, present tense, no rationale and no dead history. The *why* behind each choice lives in the [decision records](decisions/README.md), linked from the section it explains. The *not-yet-built* work lives in each doc's Implementation status section and in [plans](../plans/). Questions we have deliberately **not** decided yet live in [open problems](open-problems/) — a tortok-specific extension to the stock discipline, with phase-gated `Must resolve by` headers.

If you're an agent or a new reader, start here: this page maps every area to its current-state doc and the decisions behind it.

| Area | Reference | Decisions behind it |
|---|---|---|
| P2P & torrent engine | [p2p-torrent](p2p-torrent.md) | 0001, 0008, 0009, 0014, 0015 |
| Federation (atproto) | [federation](federation.md) _(stub)_ | 0002, 0003, 0010, 0012 |
| Client (Expo / React Native) | [client](client.md) | 0004, 0007, 0009, 0016, 0017 |
| Backend / AppView | [backend](backend.md) | 0005 |
| Auth & signup | [auth-signup](auth-signup.md) _(stub)_ | 0007 |
| Monetization | [monetization](monetization.md) _(stub)_ | 0011 |
| Moderation | [moderation](moderation.md) _(stub)_ | 0013 |

Decision 0006 (migration from the Swift prototype) is mostly project history rather than an area of the live system; its phasing lives in the phases table in [`CLAUDE.md`](../../CLAUDE.md) and the [plans](../plans/), and [backend](backend.md) links it for the legacy-backend retirement it schedules.

Area docs are written incrementally. `p2p-torrent`, `backend` and `client` are written in full; the rest are **stubs** (they carry their decision links and an Implementation-status note, but their present-tense write-up is pending a verified backfill against the current code — see [Follow-ups](#follow-ups) below). Copy `_template.md` to replace a stub as each one is written.

## Follow-ups

Open doc-maintenance threads from the [claude-project-discipline](https://robtaylor.github.io/claude-project-discipline/) adoption (PR #1):

1. **Backfill the stub area docs** — write `federation`, `auth-signup`, `monetization`, and `moderation` in full (`backend` and `client` are done), present tense, each claim checked against the current code. Use [`p2p-torrent.md`](p2p-torrent.md) as the model for depth and file-referencing. As each decision's current-state claims move into its area doc, the decision record stays frozen.
2. **Propose the `open-problem` kind upstream** — tortok keeps [`open-problems/`](open-problems/README.md) as an extension because stock claude-project-discipline has no phase-gated "forced decision" kind. Pitch it upstream (first-class kind, or a documented stock way to express it). Tracked in [`open-problems/README.md`](open-problems/README.md).
