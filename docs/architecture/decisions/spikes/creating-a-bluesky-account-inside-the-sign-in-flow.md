# Spike — Creating a Bluesky account inside the sign-in flow

**Status:** Open. Time-box: one day. Q1 to Q3a were answered on 2026-11-14. Q3b needs one real sign-up on `bsky.social`, typed by a person, and the spike stays open until that is run.

## Question

Can the app's sign-in open Bluesky's account-creation page and get the person back signed in as the new account, using the OAuth client the app already has?

## Why this is in question

The login screen takes the handle of an account the person already has, and nothing else ([auth-signup](../../auth-signup.md)). [Decision 0019](../0019-v1-uses-existing-pds-via-oauth.md) keeps account creation on the user's PDS. Someone with no atproto account has to find Bluesky, sign up there, come back and type their new handle.

atproto OAuth lets a client ask the server for its sign-up page with `prompt=create`. [Decision 0026](../0026-the-sign-in-screen-offers-to-create-a-bluesky-account.md) proposes a button that does that. Before accepting it we need to know:

- whether the app's OAuth library passes the option on, and takes a server address where sign-in takes a handle;
- whether `bsky.social` honours the option for tortok's own client;
- whether a sign-up ends back at the client with a session, as a sign-in does.

## Approach

`scripts/oauth-signup-spike.mjs` drives the app's own OAuth library (`tortok/node_modules`) from Node, with keys and state held in memory.

- **Q1. Does the library pass `prompt` on, and accept a server address?** Read `@atproto/oauth-client-expo` 0.0.10 and `@atproto/oauth-client` 0.6.1 as installed, and `bsky.social`'s authorization-server metadata.
- **Q2. Does `bsky.social` show its sign-up page to tortok's client?**
  - `node scripts/oauth-signup-spike.mjs url` pushes the authorization request the app would send: tortok's `client_id`, the `app.tortok:/auth/callback` redirect, `display=touch` and `prompt=create`.
  - Open the URL it prints in a browser and look at the page. Submit nothing.
- **Q3. Does a sign-up end back at the client, signed in?** The script's `loopback` mode sends the same options from a development loopback client and listens on the redirect. It exchanges the code and prints the DID and handle of the account that authorized it.
  - **Q3a.** Against the local test network (`test-network/start.mjs`), whose PDS runs Bluesky's OAuth pages (`@atproto/dev-env` 0.7.5). The account is thrown away with the network.
  - **Q3b.** Against `bsky.social`. This creates a real Bluesky account, so a person types the email, the password and any check Bluesky asks for.
- **Q4. Does it work through the app's system auth browser,** on the iOS simulator and the Android emulator? Left to the build: the button calls the same `signIn` as today with one more option.

## Decision matrix

| Outcome | Means | Action |
|---|---|---|
| Q1 or Q2 fails | The option doesn't reach Bluesky, or Bluesky ignores it for third-party clients | Decision 0026 is rewritten around a plain link to Bluesky's sign-up page |
| Q1 and Q2 pass, Q3 fails | The sign-up page opens, but the person isn't returned signed in | The same plain link, since a button that strands people is worse than none |
| Q1 to Q3 pass | The button works with the library as it is | Decision 0026 is accepted; the spike resolves YES |

## Findings

All on 2026-11-14.

- **Q1 passes.** Read in the installed files:
  - `ExpoOAuthClient.signIn(input, options)` spreads `options` into `authorize()`, which spreads them into the pushed authorization request (`oauth-client-expo/dist/expo-oauth-client.native.js`, `oauth-client/dist/oauth-client.js`).
  - Given an `https://` server address, `authorize()` resolves no identity and sends no `login_hint`. A bare host name would be resolved as a handle, so the button has to pass the full URL.
  - `bsky.social`'s metadata lists `create` in `prompt_values_supported`, and requires pushed requests.
- **Q2 passes.** `bsky.social` accepted the pushed request for tortok's own client. The URL opened on a page titled "Sign up", "Step 1 of 3", "Choose a username", with handles under `.bsky.social`. Nothing was submitted, so steps 2 and 3 weren't seen.
- **Q3a passes.** The local PDS's metadata lists `create` too.
  - Its page was the same "Sign up", in two steps: a username, then an email and a password.
  - Submitting it went straight to "Authorize" for the new account, with no separate sign-in.
  - Authorizing redirected to the client with `state`, `iss` and `code`. The exchange gave a session with scope `atproto transition:generic`, for an account whose handle was the one just chosen.
  - The callback doesn't carry the handle. The script read it from the PDS with `com.atproto.repo.describeRepo`.
- **Q3b isn't run.** Bluesky's page has a third step that the local one lacks. What it asks for, and whether the flow carries on to "Authorize" after it, is the remaining unknown.
- **A limit of Q3:** the loopback runs use a development client, not tortok's `client_id`. Q2 is the only run with tortok's own.

## Outcome

(Filled in when Q3b has been run.)
