// Test-only sign-in with an app password, for end-to-end tests.
//
// Detox can't drive the system browser that atproto OAuth opens, and the
// real test account allows only a few logins a day. So e2e builds sign in
// with an app password against the throwaway PDS that CI starts
// (test-network/start.mjs; docs/architecture/decisions/spikes/test-pds-in-ci.md).
//
// Present only when the bundle is built with EXPO_PUBLIC_E2E=1, which Expo
// inlines at build time. Release builds for users never set it.

import { AtpAgent } from '@atproto/api';

export const DEV_SIGN_IN_ENABLED = process.env.EXPO_PUBLIC_E2E === '1';

export class DevSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevSignInError';
  }
}

/** Log in to `service` with an app password; returns the account's DID and handle. */
export async function devSignIn(
  service: string,
  identifier: string,
  appPassword: string,
): Promise<{ did: string; handle: string }> {
  if (!DEV_SIGN_IN_ENABLED) throw new DevSignInError('dev sign-in is not built into this app');
  const agent = new AtpAgent({ service });
  const { data } = await agent.login({ identifier, password: appPassword });
  return { did: data.did, handle: data.handle };
}
