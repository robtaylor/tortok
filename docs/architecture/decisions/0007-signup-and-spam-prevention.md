# Decision 0007: Signup UX and spam prevention

**Status:** Accepted. Amended 2026-04-29 — signup is now atproto OAuth
against the user's existing PDS, not a custodial email + password flow.
See "Amendment 2026-04-29" below.

**Amendment 2026-04-29.** This decision originally specified a clean,
TorTok-branded signup with atproto as invisible backend plumbing. That
stance has been reversed. The new flow is atproto OAuth against the
user's existing PDS — typically `bsky.social`. The spam-prevention
ladder below largely becomes N/A: the user's PDS handles signup spam
for us. Per-user rate limits at our AppView remain in scope.

The product hypothesis underlying the original decision record ("exposing Bluesky
at the user level is what we don't want") has flipped. The new
hypothesis is that surfacing Bluesky on signup is a *credibility*
signal — established protocol, recognised brand, real account, you
arrive in TorTok already plugged into a community. We will revisit
this if onboarding-funnel data contradicts it.

The original Context, Decision, escalation ladder, and Alternatives
ruled out are retained below for the audit trail. They no longer
describe the v1 flow. The question of whether TorTok ever runs its
own PDS — for any reason: signup branding, Bluesky restricting our
Lexicon, protocol-layer moderation control — is now an open problem
in `docs/architecture/open-problems/own-pds.md` with documented
triggers to revisit.

**Decision (as amended 2026-04-29).**

Signup and login are **atproto OAuth against the user's PDS**. The
client embeds the standard atproto OAuth flow (`@atproto/api`). Most
users land on `bsky.social`; users on third-party PDSes work the same
way. We do not run an auth endpoint of our own; we do not store
passwords; we do not generate `did:plc` identities; we do not hold
rotation keys.

We still publish a `app.tortok.video.post` Lexicon (Decision 0002), still run our
own AppView (Decision 0005), and still write video records signed by the
user's repo key into the user's PDS via `@atproto/api`.

**Spam prevention (as amended).**

The user's PDS handles signup-time spam (Bluesky uses Turnstile;
third-party PDSes vary). We retain authority over per-user rate limits
at the AppView ingest and at our own backend endpoints (e.g., upload
quotas, posting cadence). The escalation ladder below is preserved as
a reference for the AppView surface, not the signup surface.

---

**Original Context (pre-amendment).** Earlier drafts of Decision 0005 assumed
users would bring their own atproto identity from an existing PDS
(typically bsky.social) and log in via atproto OAuth. Research
confirmed Bluesky themselves dropped SMS verification in February 2024
in favour of CAPTCHA-only signup, and exposing Bluesky at the user
level is explicitly not what we want for TorTok — we want a clean,
familiar, branded experience where atproto is backend plumbing the
user never sees. This decision defines the signup flow and the
spam-prevention strategy that sits in front of it.

**Original Decision (pre-amendment).**

Signup is **email + password + CAPTCHA**. Nothing else. No phone
number, no "pick a PDS" step, no mention of Bluesky, atproto, DIDs,
handles, or anything else protocol-specific in the UI.

**CAPTCHA choice: Cloudflare Turnstile** as the default. Rationale:
- Usually invisible to the user (shows a puzzle only when risk is
  elevated), which matches the "simple flow" goal
- Free at our expected scale
- Single drop-in widget with server-side verification
- Cloudflare operates a huge share of the web, so false positives on
  legitimate users are rare

**hCaptcha** is an acceptable fallback if Turnstile doesn't work out in
practice — they are functionally interchangeable for our use case and
switching later is a one-day job.

**Signup flow (server side).**
1. Client POSTs email, password, and Turnstile token to our signup
   endpoint
2. Backend verifies the Turnstile token with Cloudflare
3. Backend creates a `did:plc` identity via our PDS
4. Backend generates the rotation key server-side (custodial per
   Decision 0003) and stores it in a dedicated secrets store (not the main
   application database)
5. Backend hashes the password with argon2id and stores the credential
6. Backend sends a verification email containing a one-time activation
   link
7. Backend returns a session token; the client lands on the home feed
   with a banner asking the user to verify their email before they
   can post
8. When the user clicks the activation link, the account is marked as
   email-verified and posting is unlocked

**Password reset** is a standard email-link flow. Because we hold the
rotation key custodially, password reset recovers full account access.

**Escalation ladder (in increasing order of cost and complexity):**
1. Turnstile default settings — ship with this
2. Tighten Turnstile risk settings if abuse appears
3. Per-IP and per-email rate limits at signup (1–2 days of work)
4. Account-age gating on first post (no posting for N hours after
   signup; N tunable)
5. Posting rate limits keyed on account age (new accounts post slower)
6. Build or contract a phone-verification labeler (weeks of work; only
   if spam is a business-threatening problem)
7. Proof-of-personhood integration (Worldcoin or similar) if the abuse
   is sophisticated enough to warrant it

We stop climbing the ladder as soon as abuse is under control. Most
consumer apps of TorTok's shape and scale live comfortably at rung 1–3.

**Consequences.**
- Users see a normal signup flow. Zero atproto vocabulary.
- We take on standard email/password auth complexity: password
  hashing (argon2id), email delivery (pick a provider in Phase 3),
  reset tokens, email verification gating. None of this is novel; all
  of it is real work.
- We take on custodial key management for rotation keys. This is the
  most sensitive part of the stack — treat the secrets store with
  extra care (KMS, audit logging, least-privilege access).
- Users never think about Bluesky. The atproto substrate is invisible,
  which is both the goal and the reason we're running our own PDS.

**Alternatives ruled out.**
- **SMS verification.** Cost, privacy friction, international
  accessibility problems, and a signal that's easily bypassed with
  VoIP numbers. Bluesky reached the same conclusion in Feb 2024.
- **OAuth via atproto (bring-your-own-PDS).** Would expose
  "sign in with Bluesky" at the user level. Explicitly not what we
  want.
- **Magic links / passwordless.** Arguably better UX, but puts email
  delivery on the critical auth path. Defer — easy to swap in later
  if we decide passwords are the wrong call.
- **Social login (Google, Apple).** Adds platform dependencies and
  complicates the "cross-platform, own the UX" story. Defer to a
  later decision record if user research suggests it matters.

**Concrete defaults for the escalation ladder.**

These are the numbers we ship with. They are adjustable in config
without a code change.

- **Rung 3 — signup rate limits.** 5 signups per IP per hour, 3 signups
  per email address per day. Tighten both by 5× the moment abuse shows up.
- **Rung 4 — account-age gating.** No posting for the first hour after
  signup (plus email verification, which is already required). This is
  cheap to add and catches the crudest abuse patterns.
- **Rung 5 — posting rate limits by account age.**
  - First 7 days: 3 posts/day, 10 follows/day, 50 likes/day.
  - Established accounts: 10 posts/hour, 30 follows/hour, 100 likes/hour.
  These limits are defaults, not spam thresholds — legitimate heavy
  users will never hit them; spammers will hit them on the first
  minute. Return 429 with a visible cooldown timer in the UI.

Broader content-moderation policy (reporting, NSFW classification,
labeler integration, UK age-verification gating) is resolved in
Decision 0013.
