# Auth & signup

*Reference: the current design as it stands in the code. The why lives in the decision records linked from each section; the not-yet-built work is under [Implementation status](#implementation-status). Present tense means "true today". If a claim here is stale, the code moved and this doc didn't.*

tortok has no accounts of its own. A user signs in with the atproto account they already have, by OAuth against their own PDS, and the app learns their DID ([Decision 0019](decisions/0019-v1-uses-existing-pds-via-oauth.md)). Sign-in lives entirely in the client. The backend has no auth at all.

## Sign-in

The login screen (`tortok/app/(auth)/login.tsx`) asks for a Bluesky handle and has one button, "Sign in with Bluesky". The client resolves the handle through `https://bsky.social`, opens the system auth browser on the user's PDS, and receives the redirect at `app.tortok:/auth/callback`. The flow is atproto OAuth with PAR and DPoP, run by `@atproto/oauth-client-expo` (`tortok/lib/atproto/oauth.ts`). Its mechanics are in [client](client.md#authentication).

tortok is a public OAuth client. Its `client_id` is the URL of its metadata document, `https://tortok.app/.well-known/oauth-client-metadata.json`, whose source is `web/public/.well-known/`. The app bundles a copy at `tortok/assets/oauth-client-metadata.json`. The document requests the scope `atproto transition:generic` and registers two redirect URIs: the app scheme, and `https://tortok.app/auth/callback` for web, served from `web/public/auth/callback.html`.

What the app keeps from a sign-in is the DID and the handle the user typed.

## Signup

There is none. The app creates no accounts and has no sign-up link: an account is created, and recovered, on the user's PDS. Any atproto account on any PDS can sign in. Nothing in the app or the backend holds an allowlist, an invite check or an age check.

## Sessions

The auth store (`tortok/stores/auth.ts`) holds the DID and the last handle. They persist in `expo-secure-store` on native and in `localStorage` on web. The OAuth client keeps the tokens and DPoP keys in its own store. On launch the store restores the DID and warms the OAuth session in the background. The root layout shows the tabs when there is a DID and the login screen when there isn't ([client](client.md#navigation-and-session-gating)).

Signing out revokes the OAuth session and clears the DID. A failed revoke is logged and the sign-out goes ahead. The last handle stays, to pre-fill the login field.

Today the session authorises nothing. The AppView's API is public, so the app calls it without credentials, and the app writes nothing to the user's PDS. Signing in decides only which screens the app shows.

## Backend

The backend holds no accounts, passwords or sessions, and every route is public and read-only ([backend](backend.md#auth)). It knows an author only as the DID in a record it indexed.

## Test sign-in

Detox can't drive the system browser that OAuth opens. So an end-to-end build, bundled with `EXPO_PUBLIC_E2E=1`, adds a second form to the login screen (`tortok/lib/atproto/devSignIn.ts`). It logs in to the e2e stack's throwaway PDS with an app password and hands the app that account's DID and handle. It creates no OAuth session. User builds never set the flag, and without it `devSignIn` throws.

`scripts/seed-fixtures.mjs` also signs in with an app password, to the dev account, and caches its session in `~/.cache/tortok/` because that account allows 10 logins a day.

## Spam prevention

tortok has none of its own. Signup spam is the PDS's to stop ([Decision 0007](decisions/0007-signup-and-spam-prevention.md), as revised by Decision 0019). The AppView indexes every valid record from any account, with no per-account limit, and its endpoints have no rate limits.

## Constraints

- The three copies of the client metadata must be identical: the hosted document, its source in `web/public/.well-known/`, and the app's bundled copy. Nothing checks this in CI. They were identical when checked on 2026-11-13.
- The host that resolves handles, `https://bsky.social`, is fixed in the client.
- The automated tests don't cover the OAuth flow. The Detox suite uses the test sign-in.

## Implementation status

**Implemented:**

| Part | Where |
|---|---|
| OAuth sign-in, session restore and revocation | `tortok/lib/atproto/oauth.ts`, `tortok/stores/auth.ts`, `tortok/app/(auth)/login.tsx` |
| Client metadata, hosted and bundled | `web/public/.well-known/oauth-client-metadata.json`, `tortok/assets/oauth-client-metadata.json` |
| Web redirect page | `web/public/auth/callback.html` |
| Session gating of the app's screens | `tortok/app/_layout.tsx` |
| Test sign-in for end-to-end builds | `tortok/lib/atproto/devSignIn.ts` |

**Deferred:**

| Part | Gap | Tracking |
|---|---|---|
| Using the session | Nothing is written to the user's PDS yet, so the session is unused. | [Phase 3 plan](../plans/phase-3-atproto.md), Unit 3 |
| OAuth on Android and web | The round trip was verified on the iOS simulator only (2026-05-02). On web, `oauth.ts` builds the OAuth client when the module loads. Unit 2.5's first attempt found that this crashes Expo Router's web render pass (`indexedDB is not defined`), and its lazy-init fix hasn't been carried over. | [Phase 3 plan](../plans/phase-3-atproto.md), Unit 2 and "What carries forward from attempt 1" |
| Web cookie auth | On web the sign-in state sits in browser storage, not a cookie. | [Phase 3 plan](../plans/phase-3-atproto.md), Unit 7 |
| A test of the real OAuth flow | No suite drives the auth browser. One per platform is planned, run nightly or by hand. | [Phase 3 plan](../plans/phase-3-atproto.md), decision 3 of Unit 2.5 |
| A CI check on the client metadata | The copies are compared by hand. | None yet |
| Rate limits | Decision 0019 item 3 keeps per-user rate limits at the AppView's ingest and endpoints. None exist. | None yet |
| Age verification | Decision 0013's UK age gate isn't built. | [moderation](moderation.md) |
| A way in without an account | The login screen has no sign-up action. A "Create a Bluesky account" button, which opens Bluesky's sign-up inside the OAuth flow, is proposed and not built. | [Decision 0026](decisions/0026-the-sign-in-screen-offers-to-create-a-bluesky-account.md) (Proposed) and its [spike](decisions/spikes/creating-a-bluesky-account-inside-the-sign-in-flow.md) |
| tortok's own signup | tortok runs no PDS, so it can't create accounts. | [`open-problems/own-pds.md`](open-problems/own-pds.md) |

## Decisions behind this

- [Decision 0007 — Signup UX and spam prevention](decisions/0007-signup-and-spam-prevention.md)
- [Decision 0019 — v1 uses each user's existing PDS through atproto OAuth](decisions/0019-v1-uses-existing-pds-via-oauth.md)
- [Decision 0003 — Identity uses DIDs](decisions/0003-identity-dids.md)
