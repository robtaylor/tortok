// atproto OAuth singleton client.
//
// Phase 3 Unit 2: replaces the legacy email/password backend login with
// PAR + DPoP OAuth against the user's atproto PDS (typically
// bsky.social). See plans/squishy-stargazing-hopcroft.md.
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
//
// IMPORTANT: lazy-construct. The .web variant of ExpoOAuthClient
// reaches for `indexedDB` in its constructor, which doesn't exist in
// Node. expo-router's static-render pass evaluates this module
// server-side and would crash before the iOS bundle was emitted, taking
// Metro down with it. The lazy getter ensures we only touch the
// platform-specific OAuth machinery when something actually calls
// signIn / restore / revoke from a runtime context.
let _oauthClient: ExpoOAuthClient | null = null;
function getOauthClient(): ExpoOAuthClient {
  if (_oauthClient) return _oauthClient;
  _oauthClient = new ExpoOAuthClient({
    // Used to resolve atproto handles (foo.bsky.social) to DIDs and
    // PDS URLs. Falling back to bsky.social matches the smoke test.
    handleResolver: 'https://bsky.social',
    clientMetadata: clientMetadata as Parameters<
      typeof ExpoOAuthClient
    >[0]['clientMetadata'],
  });
  return _oauthClient;
}

/**
 * Begin the OAuth sign-in flow. Opens the system auth browser (Sign In
 * with Bluesky / ASWebAuthenticationSession on iOS, Custom Tabs on
 * Android), waits for the deep-link redirect to `app.tortok:/auth/callback`,
 * and returns the resolved session.
 *
 * `input` may be a handle (e.g. `tortok-dev.bsky.social`) or a PDS host.
 */
export function signIn(input: string): Promise<OAuthSession> {
  return getOauthClient().signIn(input);
}

/**
 * Restore a session from a previously persisted DID. The OAuth client
 * holds its own session cache in MMKV; we only need the DID to look it
 * up. Used by auth-store hydration on cold start.
 */
export function restore(did: string): Promise<OAuthSession> {
  const c = getOauthClient();
  return c.restore(did as Parameters<typeof c.restore>[0]);
}

/**
 * Revoke the session server-side and drop it from the local store.
 * Equivalent to `(await restore(did)).signOut()` but without forcing
 * a token refresh first.
 */
export function signOut(did: string): Promise<void> {
  const c = getOauthClient();
  return c.revoke(did as Parameters<typeof c.revoke>[0]);
}
