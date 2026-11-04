# Architecture

The current design of tortok, by area. Each area is a **reference** doc: what the code does today, present tense, no rationale and no dead history. The *why* behind each choice lives in the [decision records](decisions/README.md), linked from the section it explains. The *not-yet-built* work lives in each doc's Implementation status section and in [plans](../plans/). Questions we have deliberately **not** decided yet live in [open problems](open-problems/) — a tortok-specific extension to the stock discipline, with phase-gated `Must resolve by` headers.

If you're an agent or a new reader, start here: this page maps every area to its current-state doc and the decisions behind it.

| Area | Reference | Decisions behind it |
|---|---|---|
| P2P & torrent engine | _pending_ | 0001, 0008, 0009, 0014, 0015 |
| Federation (atproto) | _pending_ | 0002, 0003, 0010, 0012 |
| Client (Expo / React Native) | _pending_ | 0004 |
| Backend / AppView | _pending_ | 0005 |
| Auth & signup | _pending_ | 0007 |
| Monetization | _pending_ | 0011 |
| Moderation | _pending_ | 0013 |

Decision 0006 (migration from the Swift prototype) is project history rather than an area of the live system; it lives in the phases table in [`CLAUDE.md`](../../CLAUDE.md) and the [plans](../plans/).

Area docs are written incrementally. `p2p-torrent` is written; the rest are `_pending_` and will be backfilled against the current code (see the follow-up in the adoption plan). Copy `_template.md` to `<area>.md` as each one is written, then turn its row above into a link.
