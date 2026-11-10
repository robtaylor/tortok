# Open problem: Should TorTok run its own PDS?

**Status:** Parked. v1 uses users' existing atproto identities
(typically `bsky.social`); no TorTok PDS is in scope.
**Must resolve by:** No phase forces this currently. Revisited when one
of the trigger conditions below fires — at which point this becomes a
new decision record, not a sketch.
**Blocks:** nothing in the v1 phase plan.
**Related decision records:** Decision 0002 (federation protocol), Decision 0003 (identity, as
amended 2026-04-29), Decision 0005 (backend evolves to AppView), Decision 0006
(Phase 3 scope, as amended 2026-04-29), Decision 0007 (signup UX, as amended
2026-04-29).

## The question

TorTok's v1 architecture uses whichever PDS the user is already on
— for the overwhelming majority that is `bsky.social`. We define our
own Lexicon (`app.tortok.video.post`), run our own AppView, and write
records into the user's existing repo via `@atproto/api`. We do not
fork the reference PDS, we do not run signup ourselves, and we do not
hold rotation keys.

This decision is reversible. The question is: **under what conditions
would the cost of running our own PDS become worth it again?**

## Costs we are currently avoiding

- Forking `bluesky-social/atproto`'s reference PDS and tracking
  upstream forever.
- Operating a second stateful service (PDS) alongside the AppView.
- Choosing per-user upload quotas, which set the abuse surface and the
  storage bill. Users' existing PDSes apply their own blob limits today.
- Custodial rotation-key storage (KMS, audit logging, breach
  surface).
- Email/password auth: argon2id, email delivery on critical path,
  reset tokens, verification.
- Signup spam ladder (Turnstile, rate limits, account-age gating;
  Decision 0007's original escalation ladder).
- Lexicon governance — already an issue, but more pressing if we
  sole-source storage.

## Risks we have taken on by punting

- **Lexicon-restriction risk.** `bsky.social` could in principle
  rate-limit, refuse, or filter `app.tortok.video.post` records. The
  atproto spec says PDSes accept arbitrary lexicons; Bluesky has not
  signalled any change. But we don't control that lever.
- **Blob-size risk.** `bsky.social` has limits on blob size (currently
  ~1MB for thumbnails; verify before launch). Our thumbnails should
  fit but this needs measurement.
- **Auth-availability risk.** If `bsky.social` is down, our users
  can't post or sign in. Bluesky's uptime is currently good but it's
  another dependency we don't control.
- **No protocol-layer moderation control.** A user banned from
  `bsky.social` for unrelated reasons loses TorTok access until they
  migrate PDS. Conversely, we cannot deplatform a TorTok-problematic
  user at the protocol layer; only at our AppView (refuse to index).
- **Brand surface.** "Sign in with Bluesky" is visible at signup. We
  currently believe this is a credibility signal (see Decision 0007
  amendment). If the data shows otherwise, that's a trigger to
  revisit.

## Triggers to revisit

Any of these would make the trade flip:

1. **Bluesky restricts third-party lexicons.** Public policy change,
   rate limits applied to non-`app.bsky.*` records, blob-size cuts,
   or refusal to serve `app.tortok.video.post` records.
2. **Onboarding-funnel data shows real friction.** Conversion from
   "tap signup" to "first video posted" lags below product
   expectations and user research traces it to the Bluesky-account
   step.
3. **Product needs a TorTok-branded signup option.** Marketing,
   creator partnerships, or platform deals require a "sign up with
   TorTok" flow that doesn't surface Bluesky.
4. **Moderation needs protocol-layer control.** TorTok-problematic
   users who keep their Bluesky accounts and bypass our AppView
   blocks become a recurring problem.
5. **Auth-availability incidents.** `bsky.social` outages start
   showing up in our SLO miss budget.
6. **Self-hosting pressure.** Significant fraction of users want to
   run TorTok against their own PDS; the federation story improves
   if we offer one as a reference.

## Candidate approaches when we revisit

Listed roughly in increasing investment.

- **Stay as-is.** No own-PDS, monitor triggers. (Current.)
- **Run our own PDS as an alternative auth source.** "Sign up with
  TorTok" alongside "sign in with Bluesky." Adds branded signup; keeps
  the easy on-ramp for existing atproto users. Ratchets up cost
  significantly (most of original Decision 0003/007 surface returns).
- **Run our own PDS as the default, with Bluesky OAuth as a
  shortcut.** The original Decision 0006 Phase 3 plan, with an OAuth side
  door. Most expensive; gives us the most control.
- **Pick a different sovereignty model (e.g., `did:web` for
  TorTok-hosted users).** Sidesteps PLC dependency too. Higher cost
  per user; useful only if we want power users to be sovereign by
  default.

## What we'd measure to decide

- Signup funnel conversion (where users drop off in OAuth flow).
- Bluesky's published rate-limit and lexicon-policy posture (track
  every quarter).
- Moderation incidents we couldn't resolve at the AppView layer.
- Survey signal from creators on the "sign in with Bluesky" experience.
- Outage exposure: hours per month our users couldn't post because of
  upstream PDS issues.

The right time to revisit is not "when it would be nice to control
this" — it's "when one of the triggers above has materially fired."
The cost of running our own PDS is high; the trigger should justify it.
