# Open problem: Can people watch the feed without signing in?

**Status:** Unresolved. Raised 2026-11-11 while planning production smoke checks.
**Must resolve by:** Phase 4 AppView cutover, together with
`view-counting.md`, since the answer changes what a view can be tied to.
Before public release at the latest, because it shapes the first screen a
new user sees.
**Blocks:** a production app smoke test that doesn't sign in; any
signed-out onboarding design.
**Related decision records:** Decision 0016 (testing strategy), Decision 0019
(sign-in with an existing PDS through OAuth).
**Related open problems:** `view-counting.md`.

## The problem

Today the app shows the login screen until someone has signed in: the root
layout redirects to `/(auth)/login` whenever there's no DID
(`tortok/app/_layout.tsx`). The backend doesn't need a session to serve the
feed: `GET /videos/feed` and `POST /videos/:id/view` both take an optional
JWT (`backend/src/routes/videos.ts`).

Letting people watch before signing in, as TikTok does, has three pulls:

- **New users.** Someone can see what tortok is before creating or linking an
  atproto account.
- **Testing.** A smoke test of the real app against production could check the
  feed and playback without logging in. That avoids the dev account's limit of
  about 10 logins a day, and keeps the test read-only.
- **Seeding.** Signed-out clients can still seed under Decision 0009's policy,
  which doesn't depend on identity.

The cost is on view counting. A signed-out view has no DID behind it, so it
can't be deduplicated per account or weighted by an account's history, and
it's cheaper to fake in bulk. If views become the signal creators sell
sponsorships on (`view-counting.md`), anonymous views either weaken it or have
to be counted separately.

## Candidate approaches

1. **Sign-in required (today).** Simplest, and every view has a DID. New users
   meet a login screen first, and production smoke tests must log in.
2. **Signed-out watching, with sign-in for everything else.** Liking, posting
   and following need an account. Signed-out views are either not counted or
   counted in a separate, unweighted bucket that ranking and creator stats
   ignore.
3. **A signed-out taster.** A fixed number of clips, or a fixed time, then a
   prompt to sign in. Limits how many anonymous views there can be, at the cost
   of a harder wall later.

## Current leaning (2026-11-11)

Not a decision. Candidate 2 with signed-out views not counted at all. Under
`view-counting.md`'s current leaning, clients report watching through
`sendInteractions`, which the user's PDS authenticates; a signed-out client
has no PDS to do that, so not counting its views falls out of the design
rather than needing a separate bucket. It also matches how TikTok's
qualified views, the ones monetization pays on, count one per account (see
`view-counting.md`).

## What would settle it

- Which view-counting approach `view-counting.md` lands on, and whether a
  public play count shown to everyone should include signed-out plays.
- Whether moderation or launch criteria (Decision 0013) require an account
  before content is shown.
