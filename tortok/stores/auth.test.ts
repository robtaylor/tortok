// Unit tests for the auth store. Phase 3 Unit 2 — covers the new
// atproto OAuth integration: signInWithDid, signOut (with revoke),
// hydrate (with restore).
//
// Run via:
//   npx jest --config stores/jest.config.js
// from the `tortok/` dir.

import { useAuthStore } from './auth';

// --- Mocks ---

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('@/lib/atproto/oauth', () => ({
  signIn: jest.fn(),
  restore: jest.fn(),
  signOut: jest.fn(),
}));

// Re-import the mocked module for assertion access.
const oauth = jest.requireMock('@/lib/atproto/oauth') as {
  signIn: jest.Mock;
  restore: jest.Mock;
  signOut: jest.Mock;
};
const secureStoreMock = jest.requireMock('expo-secure-store') as {
  __store: Map<string, string>;
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const TEST_DID = 'did:plc:teqobv6pqer5nw7roqrgi55v';
const DID_KEY = 'tortok_auth_did';

beforeEach(() => {
  // Reset store contents.
  secureStoreMock.__store.clear();
  // Reset zustand state.
  useAuthStore.setState({
    token: null,
    user: null,
    did: null,
    isLoading: true,
  });
  oauth.signIn.mockReset();
  oauth.restore.mockReset();
  oauth.signOut.mockReset();
});

describe('signInWithDid', () => {
  it('persists the DID to secure storage and updates state', async () => {
    await useAuthStore.getState().signInWithDid(TEST_DID);

    expect(secureStoreMock.__store.get(DID_KEY)).toBe(TEST_DID);
    expect(useAuthStore.getState().did).toBe(TEST_DID);
  });
});

describe('signOut', () => {
  it('clears DID from storage, resets state, and revokes server-side', async () => {
    // Seed the store as if previously signed in.
    secureStoreMock.__store.set(DID_KEY, TEST_DID);
    useAuthStore.setState({ did: TEST_DID, token: 'legacy-jwt', user: null });
    oauth.signOut.mockResolvedValue(undefined);

    await useAuthStore.getState().signOut();

    expect(oauth.signOut).toHaveBeenCalledWith(TEST_DID);
    expect(secureStoreMock.__store.has(DID_KEY)).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({
      did: null,
      token: null,
      user: null,
    });
  });

  it('still clears local state when server revoke fails', async () => {
    // A network error during revoke must not strand the user signed-in
    // locally — the load-bearing step is the local state clear.
    secureStoreMock.__store.set(DID_KEY, TEST_DID);
    useAuthStore.setState({ did: TEST_DID });
    oauth.signOut.mockRejectedValue(new Error('network down'));

    // Suppress the expected console.warn for cleaner test output.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();

    expect(useAuthStore.getState().did).toBeNull();
    expect(secureStoreMock.__store.has(DID_KEY)).toBe(false);
    warnSpy.mockRestore();
  });
});

describe('hydrate', () => {
  it('loads the DID from storage and triggers oauthRestore (fire-and-forget)', async () => {
    secureStoreMock.__store.set(DID_KEY, TEST_DID);
    oauth.restore.mockResolvedValue({ sub: TEST_DID });

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().did).toBe(TEST_DID);
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(oauth.restore).toHaveBeenCalledWith(TEST_DID);
  });

  it('starts signed-out cleanly when nothing is persisted', async () => {
    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({
      token: null,
      user: null,
      did: null,
      isLoading: false,
    });
    expect(oauth.restore).not.toHaveBeenCalled();
  });
});
