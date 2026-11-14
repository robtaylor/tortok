# Decision 0026 — The sign-in screen offers to create a Bluesky account

**Status:** Proposed. Adds to [Decision 0019](0019-v1-uses-existing-pds-via-oauth.md), which stays in force: tortok still creates no accounts. Acceptance waits on the last step of the [spike](spikes/creating-a-bluesky-account-inside-the-sign-in-flow.md).

**Current architecture:** [Auth & signup](../auth-signup.md).

**TL;DR.** In the context of people who arrive at tortok with no atproto account, facing a sign-in screen that takes only the handle of an account they don't have, we chose a "Create a Bluesky account" button that opens Bluesky's own sign-up inside the sign-in flow and returns the person signed in, to give them a way in without tortok running a PDS, accepting that the account, its terms and its sign-up checks are Bluesky's.

## Context

What the code does today: the login screen has a handle field and one button, "Sign in with Bluesky". It has no sign-up action. Decision 0019 keeps account creation on the user's PDS, so someone without an atproto account has to find Bluesky, sign up there, come back and type their new handle.

atproto OAuth lets a client ask the authorization server for its sign-up page, with `prompt=create`. The spike found, on 2026-11-14:

- The app's OAuth library passes the option on, and takes a server address in place of a handle.
- `bsky.social` accepted such a request from tortok's own client and opened on its "Sign up" page.
- On a local PDS running the same pages, a sign-up went straight on to "Authorize", and the client got a session for the new account.
- A real sign-up on `bsky.social` hasn't been run. It has one step the local page lacks.

Decision 0013 says sign-up stays invite-only until its launch criteria are met. tortok has no sign-up of its own to hold back: since Decision 0019, any atproto account can sign in to the app, and nothing in tortok holds an invite check. What limits who uses tortok is who has a build, which [`release-plan.md`](../../plans/release-plan.md) governs.

Running a PDS of our own is parked in [`open-problems/own-pds.md`](../open-problems/own-pds.md).

## Decision

1. **The login screen gets a second action, "Create a Bluesky account".** It starts the OAuth flow the sign-in button starts, against Bluesky's own server, `https://bsky.social`, with `prompt=create`. Bluesky's sign-up page opens in the system auth browser. When the account exists, Bluesky asks the person to authorize tortok, and the app is signed in as it is after a sign-in.
2. **tortok still creates no accounts.** The account, its password, its terms and whatever checks sign-up asks for are Bluesky's. Items 1 to 3 of Decision 0019 stand, and the button names Bluesky, in line with its item 5.
3. **One server is offered.** The address is a constant in the client. Someone who wants another host creates their account there and signs in with their handle, as now.
4. **If Bluesky stops honouring the option for third-party clients,** the button becomes a link to Bluesky's sign-up page.

## Alternatives considered

- **A link to Bluesky's sign-up page** — rejected as the first choice because the person leaves the app, signs up, comes back and types a handle they have had for a minute. It is the fallback in item 4.
- **tortok's own PDS as a second way in** — rejected for now. The reference PDS runs unmodified, so it needs no fork, but tortok would become the host of those accounts: a source of truth to back up, everything they post anywhere on atproto to moderate, and a relay that limits new hosts. It stays parked on the triggers in `own-pds.md`.
- **A choice of hosts on the login screen** — rejected because it puts a question about PDS hosts to the people least likely to know what one is.
- **Leave the screen as it is** — rejected because the first thing a newcomer meets is a field asking for something they don't have.

## Consequences

- Someone with no account can go from the login screen to signed in without leaving the flow. Bluesky's sign-up had three steps on 2026-11-14.
- Every account made this way is a Bluesky account. Bluesky hosts it, its terms apply, and it works in every atproto app. tortok can't brand, shorten or change the sign-up.
- tortok comes to depend on Bluesky keeping `prompt=create` open to third-party clients. Its metadata advertises the option. Nothing promises it will stay.
- The app has to read the new account's handle from its PDS. After a sign-in it keeps the handle the person typed, and here they typed none.
- Decision 0013's launch criteria are untouched. The button doesn't change who can sign in, only how long it takes someone without an account.
- Sign-up spam stays Bluesky's to stop (Decision 0019 item 3). An account made through the button looks like any other.
- The automated tests can't cover the real flow, as they can't cover sign-in: Detox doesn't drive the system auth browser. They can check the button is there and what it asks for. `scripts/oauth-signup-spike.mjs` is the check by hand.
- This record doesn't schedule the work. The Phase 3 plan does, once this is accepted.

## Walk-back options

- **If Bluesky closes or changes the option:** item 4, a plain link.
- **If a trigger in `own-pds.md` fires and tortok runs a PDS:** point the button at it. The address is one constant.
- **If naming Bluesky on the button costs sign-ups:** revisit the wording with Decision 0019 item 5.
- **If people ask for other hosts:** add an optional host field behind the button.

## Links

- [Spike: creating a Bluesky account inside the sign-in flow](spikes/creating-a-bluesky-account-inside-the-sign-in-flow.md) — what was run, and what is left.
- [Decision 0019](0019-v1-uses-existing-pds-via-oauth.md) — sign-in through the user's existing PDS; added to here.
- [Decision 0007](0007-signup-and-spam-prevention.md) — signup and spam, as revised by 0019.
- [Decision 0013](0013-moderation-strategy.md) — the launch criteria this leaves alone.
- [`open-problems/own-pds.md`](../open-problems/own-pds.md) — whether tortok ever runs a PDS.
