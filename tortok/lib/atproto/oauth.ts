// atproto OAuth singleton client.
//
// Phase 3 Unit 2: replaces the legacy email/password backend login with
// PAR + DPoP OAuth against the user's atproto PDS (typically
// bsky.social). See docs/plans/phase-3-atproto.md, Unit 2.
//
// IMPORTANT — client metadata duplication:
//   The bundled `assets/oauth-client-metadata.json` MUST stay
//   byte-identical to the hosted version at
//   `web/public/.well-known/oauth-client-metadata.json` (canonical
//   `client_id`: https://tortok.app/.well-known/oauth-client-metadata.json).
//   If you change one, update the other. A future CI check should
//   diff them on every PR.
//
//   We copy rather than import the web file directly because metro's
//   project root is `tortok/`, and reaching above the project tree
//   into `../web/public/...` breaks the bundler at runtime even when
//   TypeScript accepts the path.
//
// URL polyfill: `@atproto/oauth-client-expo`'s native polyfill module
// already imports `react-native-url-polyfill/auto` and
// `core-js/proposals/explicit-resource-management` (see
// node_modules/@atproto/oauth-client-expo/dist/polyfill.native.js),
// so an explicit import here is redundant. We import it anyway for
// safety against future lib refactors and to make the dependency
// visible at the call-site.

import 'react-native-url-polyfill/auto';

import {
  ExpoOAuthClient,
  type OAuthSession,
} from '@atproto/oauth-client-expo';
import clientMetadata from '../../assets/oauth-client-metadata.json';

// `resolveJsonModule` widens string-literal types to `string`, which
// the OAuth client's `OAuthClientMetadataInput` rejects on fields like
// `token_endpoint_auth_method` ("none" | "private_key_jwt" | ...).
// Casting at the boundary is correct: the JSON file is the source of
// truth and we're vouching for its shape.
const oauthClient = new ExpoOAuthClient({
  // Used to resolve atproto handles (foo.bsky.social) to DIDs and PDS
  // URLs. Falling back to bsky.social matches the smoke test.
  handleResolver: 'https://bsky.social',
  clientMetadata: clientMetadata as Parameters<
    typeof ExpoOAuthClient
  >[0]['clientMetadata'],
});

export { oauthClient };

/**
 * Begin the OAuth sign-in flow. Opens the system auth browser (Sign In
 * with Bluesky / ASWebAuthenticationSession on iOS, Custom Tabs on
 * Android), waits for the deep-link redirect to `app.tortok:/auth/callback`,
 * and returns the resolved session.
 *
 * `input` may be a handle (e.g. `tortok-dev.bsky.social`) or a PDS host.
 */
export function signIn(input: string): Promise<OAuthSession> {
  return oauthClient.signIn(input);
}

/**
 * Restore a session from a previously persisted DID. The OAuth client
 * holds its own session cache in MMKV; we only need the DID to look it
 * up. Used by auth-store hydration on cold start.
 */
export function restore(did: string): Promise<OAuthSession> {
  return oauthClient.restore(did as Parameters<typeof oauthClient.restore>[0]);
}

/**
 * Revoke the session server-side and drop it from the local store.
 * Equivalent to `(await restore(did)).signOut()` but without forcing
 * a token refresh first.
 */
export function signOut(did: string): Promise<void> {
  return oauthClient.revoke(did as Parameters<typeof oauthClient.revoke>[0]);
}
