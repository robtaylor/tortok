# Decision 0003: Identity uses DIDs — `did:plc` default, `did:web` opt-in

**Current architecture:** [Federation](../federation.md)

**Status:** Accepted. Amended 2026-04-29 — v1 no longer runs a custodial
TorTok PDS; users authenticate via their existing atproto identity
(typically `bsky.social`). See "Amendment 2026-04-29" below.

**Context.** AT Protocol accounts are DIDs. Two methods are practical:
`did:plc` (PLC directory, currently operated by Bluesky PBC) and `did:web`
(DNS-based, self-sovereign). `did:key` is unsuitable because AT Protocol
assumes keys can rotate.

**Decision (as amended 2026-04-29).**
- Users authenticate via the atproto identity they already have. In
  practice that means `bsky.social` for the overwhelming majority;
  any atproto-compatible PDS works.
- The user's home PDS holds their rotation key, password, recovery
  flow, and blob storage. We hold none of those.
- We still build our own AppView and our own `app.tortok.video.post`
  Lexicon (see Decision 0002, Decision 0005). Records live in the user's PDS
  repo; we index them in our AppView.
- **`did:web` opt-in for sovereigns.** Power users who own a domain
  can opt into `did:web` per the standard atproto upgrade path. We
  document the DNS configuration; we do not host identity documents
  for them. Self-custody happens via the standard atproto migration
  flow against the user's PDS, not against TorTok.
- Whether to ever run our own PDS is now an open problem
  (`docs/architecture/open-problems/own-pds.md`). Triggers to revisit
  are documented there.

**Amendment 2026-04-29.** The original Decision below specified a
custodial v1 in which TorTok ran a PDS, generated `did:plc` identities
on signup, and held rotation keys server-side. That model has been
reversed. The reasoning, costs, and triggers for revisiting are in
Decision 0007's Amendment block and in `open-problems/own-pds.md`.

**Original decision (pre-amendment, retained for context).**
- Signup creates a `did:plc` identity behind the scenes. The user does
  not see this — the flow is email + password + captcha, with no
  atproto terminology in the UI (see Decision 0007).
- **v1 is custodial.** Rotation keys are held server-side by our PDS
  (see Decision 0005). Users reset their password and recover their account
  the same way they would on any standard app. Key material lives in a
  dedicated secrets store, not the primary application database.
- **Post-v1: opt-in self-custody.** A settings screen lets users
  upgrade to user-held keys. At that point the rotation key moves from
  our servers into the platform secure store (iOS Keychain, Android
  Keystore, WebCrypto on web, all accessed via Expo SecureStore's
  cross-platform API).

**Consequences (as amended).**
- v1 ships materially faster. No PDS fork, no custodial key store,
  no signup spam ladder, no email/password complexity.
- We surface "sign in with Bluesky" at the user level. The product
  hypothesis (see Decision 0007 amendment) is that this is a credibility
  and community signal, not a leak of plumbing.
- We accept dependency on the user's PDS. If `bsky.social` rate-limits
  third-party Lexicons or refuses our records, our users can't post
  through it. This is the dominant new risk; it is monitored as a
  trigger in `open-problems/own-pds.md`.
- We accept that we cannot deplatform a problematic user at the
  protocol layer. Our only lever is the AppView (refuse to index).
  A user banned from `bsky.social` for unrelated reasons loses TorTok
  access until they migrate PDS.
- Account portability and self-custody are now atproto-standard from
  day one (no upgrade flow needed).
- `did:plc` still depends on PLC directory availability. We should
  monitor proposals to decentralize PLC and follow the consensus
  migration path if one emerges.
