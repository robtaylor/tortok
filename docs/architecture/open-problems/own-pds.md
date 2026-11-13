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
records into the user's existing repo via `@atproto/api`. We run no
PDS, we do not run signup ourselves, and we do not hold rotation keys.

This decision is reversible. The question is: **under what conditions
would the cost of running our own PDS become worth it again?**

## What running our own PDS would cost

Checked on 2026-11-13 against the reference PDS's README and
configuration source (`bluesky-social/pds`, `bluesky-social/atproto`) and
the relay's source (`bluesky-social/indigo`). An earlier version of this
file assumed a fork of the reference PDS. A fork isn't needed: Bluesky
ships the PDS as a stock image, set up through environment variables.

The stock image covers these by configuration:

- Sign-in, sign-up and account pages, served by the PDS inside the OAuth
  flow the app already uses. The app can ask for the sign-up page
  (`prompt=create`).
- Branding of those pages: the service's name, logo, colours, and its
  terms and privacy links (`PDS_SERVICE_NAME`, `PDS_LOGO_URL`,
  `PDS_PRIMARY_COLOR` and others).
- Handles under our own domain (`PDS_SERVICE_HANDLE_DOMAINS`), which needs
  a wildcard DNS record.
- Email and password auth, with verification and resets, given an SMTP
  service (`PDS_EMAIL_SMTP_URL`).
- Signup gating by invite codes, on by default (`PDS_INVITE_REQUIRED`),
  and by hCaptcha (`PDS_HCAPTCHA_*`). It has no Turnstile, which
  Decision 0007 named.
- Blobs on disk or on S3-compatible storage (`PDS_BLOBSTORE_S3_*`), under
  one blob size limit for everyone (`PDS_BLOB_UPLOAD_LIMIT`, 300 MB by
  default).
- The PLC rotation key from a setting or from AWS KMS
  (`PDS_PLC_ROTATION_KEY_KMS_KEY_ID`).
- Hooks for a moderation service and a report service
  (`PDS_MOD_SERVICE_URL`, `PDS_REPORT_SERVICE_URL`).

These costs stay, fork or no fork:

- A second stateful service, and this one is a source of truth. The
  AppView's Postgres can be rebuilt from the network (Decision 0017). A
  PDS can't: losing its disk loses users' repos and keys, so backups and
  restores have to be proven.
- Key custody. The PDS holds each account's signing key and a rotation
  key for its `did:plc`.
- Email delivery on the critical path.
- Hosting duties. These are ordinary atproto accounts, so we'd host
  whatever they post to any atproto app, not only tortok video. Takedowns
  and abuse reports arrive at the PDS.
- Signup spam. Invite codes and hCaptcha are the stock tools. Anything
  more, such as the rest of Decision 0007's ladder, is ours to build in
  front of them.
- Relay limits. The relay software lets a new PDS host have 100 active
  accounts by default (`RELAY_DEFAULT_ACCOUNT_LIMIT`), and gives hosts on
  its trusted list more. What Bluesky's own relay is set to isn't known.
  The AppView reads the network through Jetstream, which that relay
  feeds, so accounts over the limit may not reach the feed.
- Upgrades of the image, in place of tracking a fork.
- Lexicon governance, which matters more if we are the only place the
  records are stored.

The stock image doesn't do these:

- Per-user upload quotas. There is one blob limit for everyone.
- Sign-up on native screens with atproto hidden, as Decision 0007 first
  described. In the OAuth flow, sign-up happens on the PDS's web pages,
  and the accounts have atproto handles. Calling the PDS's account API
  from a native screen wasn't looked at.

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
- **A "create a Bluesky account" button at sign-in.** No PDS. The app
  opens Bluesky's own sign-up page inside the OAuth flow, and the user
  comes back signed in. `bsky.social` advertises `prompt=create`, and the
  OAuth client takes a PDS address in place of a handle; both were read
  from metadata and types on 2026-11-13, and neither was run. It answers
  trigger 2 in part and trigger 3 not at all. Its own decision record is
  to follow.
- **Run a stock PDS as an alternative auth source.** "Sign up with
  TorTok" alongside "sign in with Bluesky", on the unmodified reference
  image. Adds branded signup; keeps the easy on-ramp for existing atproto
  users. Little has to be built. The cost is being a host, as listed
  above. The button of the previous candidate would point at it.
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
A stock PDS is cheap to start and costly to keep; the trigger should
justify it.
