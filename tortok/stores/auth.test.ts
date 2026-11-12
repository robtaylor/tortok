// Unit tests for the auth store. Phase 3 Unit 2 — covers the new
// atproto OAuth integration: signInWithDid, signOut (with revoke),
// hydrate (with restore).
//
// Run with `npm test` from `tortok/`.

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
const TEST_HANDLE = 'tortok-dev.bsky.social';
const DID_KEY = 'tortok_auth_did';
const LAST_HANDLE_KEY = 'tortok_last_handle';

beforeEach(() => {
  // Reset store contents.
  secureStoreMock.__store.clear();
  // Reset zustand state.
  useAuthStore.setState({
    did: null,
    lastHandle: null,
    isLoading: true,
  });
  oauth.signIn.mockReset();
  oauth.restore.mockReset();
  oauth.signOut.mockReset();
});

describe('signInWithDid', () => {
  it('persists DID and handle to secure storage and updates state', async () => {
    await useAuthStore.getState().signInWithDid(TEST_DID, TEST_HANDLE);

    expect(secureStoreMock.__store.get(DID_KEY)).toBe(TEST_DID);
    expect(secureStoreMock.__store.get(LAST_HANDLE_KEY)).toBe(TEST_HANDLE);
    expect(useAuthStore.getState().did).toBe(TEST_DID);
    expect(useAuthStore.getState().lastHandle).toBe(TEST_HANDLE);
  });
});

describe('signOut', () => {
  it('clears DID from storage, resets state, and revokes server-side', async () => {
    // Seed the store as if previously signed in.
    secureStoreMock.__store.set(DID_KEY, TEST_DID);
    useAuthStore.setState({ did: TEST_DID });
    oauth.signOut.mockResolvedValue(undefined);

    await useAuthStore.getState().signOut();

    expect(oauth.signOut).toHaveBeenCalledWith(TEST_DID);
    expect(secureStoreMock.__store.has(DID_KEY)).toBe(false);
    expect(useAuthStore.getState().did).toBeNull();
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

  it('preserves lastHandle for next-visit pre-fill', async () => {
    // Signing out shouldn't clear the handle — that's a UX convenience
    // that survives sign-out so the login screen can pre-fill the field.
    secureStoreMock.__store.set(DID_KEY, TEST_DID);
    secureStoreMock.__store.set(LAST_HANDLE_KEY, TEST_HANDLE);
    useAuthStore.setState({ did: TEST_DID, lastHandle: TEST_HANDLE });
    oauth.signOut.mockResolvedValue(undefined);

    await useAuthStore.getState().signOut();

    expect(secureStoreMock.__store.has(LAST_HANDLE_KEY)).toBe(true);
    expect(secureStoreMock.__store.get(LAST_HANDLE_KEY)).toBe(TEST_HANDLE);
    expect(useAuthStore.getState().lastHandle).toBe(TEST_HANDLE);
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
      did: null,
      lastHandle: null,
      isLoading: false,
    });
    expect(oauth.restore).not.toHaveBeenCalled();
  });

  it('loads lastHandle independently of DID (signed-out user with prior handle)', async () => {
    // After sign-out, DID is gone but lastHandle persists. Hydrate must
    // surface the handle so the login screen can pre-fill the field.
    secureStoreMock.__store.set(LAST_HANDLE_KEY, TEST_HANDLE);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().lastHandle).toBe(TEST_HANDLE);
    expect(useAuthStore.getState().did).toBeNull();
    expect(oauth.restore).not.toHaveBeenCalled();
  });
});
