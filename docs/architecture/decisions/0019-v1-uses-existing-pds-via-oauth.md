# Decision 0019 — v1 uses each user's existing PDS through atproto OAuth; no custodial PDS

**Status:** Accepted (partial) (2026-11-10). Records the reversal made on 2026-04-29, which was written into the bodies of [Decision 0003](0003-identity-dids.md), [Decision 0006](0006-migration-from-swift.md) and [Decision 0007](0007-signup-and-spam-prevention.md) as amendments. Revises the custodial-identity parts of 0003 and the branded-signup parts of 0007. Sign-in is built; publishing records to the user's PDS is not.

**Current architecture:** [Auth & signup](../auth-signup.md).

**TL;DR.** In the context of v1 signup and identity, facing the cost of forking and running a PDS that holds users' keys, we chose atproto OAuth against the PDS each user already has, to ship a smaller v1 with portable accounts from day one, accepting that tortok depends on other people's PDSes and can't deplatform anyone at the protocol layer.

## Context

Decision 0003 originally made v1 custodial: tortok would run a PDS, create a `did:plc` identity at signup and hold rotation keys server-side, with opt-in self-custody later. Decision 0007 originally specified a tortok-branded email, password and CAPTCHA signup that kept atproto out of sight, with a spam-prevention escalation ladder. Decision 0006's Phase 3 forked a PDS to match.

On 2026-04-29 the user reversed that. The reversal was recorded by adding "Amendment 2026-04-29" sections to 0003 and 0007 and rewriting 0006's Phase 3 scope. The project later adopted the rule that a decision's body is never edited after acceptance, so those records can only point at a newer one. This record is that newer one. It adds nothing that wasn't decided on 2026-04-29.

What the code did on 2026-11-10: the client signs in with `@atproto/oauth-client-expo` (PAR and DPoP) against the user's PDS, requesting scope `atproto transition:generic`. tortok runs no PDS. The client doesn't yet write any record to the user's repo, and the legacy backend still has its email and password routes, which Phase 3 retires.

## Decision

1. **Sign-in is atproto OAuth against the user's existing PDS.** Most users are on `bsky.social`; any atproto PDS works the same way. tortok runs no auth endpoint of its own, stores no passwords, creates no DIDs and holds no rotation keys.
2. **The user's PDS holds their account.** Rotation keys, password, recovery and blob storage stay with it. tortok's records (`app.tortok.video.post`, Decision 0002) are written into the user's repo with the user's session.
3. **Signup spam is the PDS's problem.** tortok keeps per-user rate limits at the AppView's ingest and at its own endpoints. Decision 0007's escalation ladder is reference material for that surface only.
4. **`did:web` works through standard atproto.** Users who own a domain can use it. tortok documents the DNS setup and hosts no identity documents.
5. **Bluesky is visible at sign-in.** The product hypothesis is that "sign in with Bluesky" signals an established protocol and a real community. It is revisited if onboarding data contradicts it.
6. **Running our own PDS is an open problem,** with its triggers in [`open-problems/own-pds.md`](../open-problems/own-pds.md).

## Alternatives considered

- **A custodial tortok PDS** (0003 and 0007 as first written) — rejected because it meant a PDS fork, a key-custody store, a signup spam ladder and email and password handling, all before v1.
- **A branded signup that hides atproto** — rejected because the product hypothesis flipped: surfacing Bluesky is now treated as a credibility signal rather than a leak of plumbing.

## Consequences

- v1 is materially smaller: no PDS, no key store, no signup flow of our own.
- Accounts are portable from day one through standard atproto migration, with no upgrade flow to build.
- tortok depends on users' PDSes. If `bsky.social` rate-limits or refuses third-party Lexicon records, those users can't post. This is a trigger in `own-pds.md`.
- tortok can't deplatform anyone at the protocol layer. Its only lever is refusing to index at the AppView (Decision 0013). A user banned from their PDS loses tortok until they migrate.
- `did:plc` depends on the PLC directory being available.

## Walk-back options

- **If a trigger in `own-pds.md` fires** (Lexicon refusal, branding, protocol-layer moderation), decide whether to run a PDS there and supersede this record.
- **If onboarding data shows the Bluesky sign-in costs users,** revisit item 5 on its own.

## Links

- [Decision 0002](0002-atproto-federation.md) — AT Protocol and the video Lexicon.
- [Decision 0003](0003-identity-dids.md) — DIDs; the custodial parts revised here.
- [Decision 0005](0005-backend-node-appview.md) and [Decision 0017](0017-appview-postgres-is-a-rebuildable-index.md) — the AppView.
- [Decision 0007](0007-signup-and-spam-prevention.md) — signup and spam; the branded-signup parts revised here.
- [`open-problems/own-pds.md`](../open-problems/own-pds.md) — whether tortok ever runs a PDS.
