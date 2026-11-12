import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  restore as oauthRestore,
  signOut as oauthSignOut,
} from '@/lib/atproto/oauth';

// The signed-in atproto identity. Only the DID is kept here; the OAuth
// session lives in the OAuth client's own store.
type AuthState = {
  did: string | null;
  // Convenience: last handle the user signed in with. Persists across
  // sign-out so the login screen can pre-fill the field on next visit.
  // Not sensitive (it's a public Bluesky handle).
  lastHandle: string | null;
  isLoading: boolean;
  signInWithDid: (did: string, handle: string) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
};

const DID_KEY = 'tortok_auth_did';
const LAST_HANDLE_KEY = 'tortok_last_handle';

// On web, expo-secure-store falls back to localStorage, which is readable
// by any XSS on the domain. See Decision 0006 Phase 3 for the planned
// migration to HttpOnly session cookies (Phase 3 Unit 7).
async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  did: null,
  lastHandle: null,
  isLoading: true,

  // atproto OAuth sign-in. Persists only the DID; the live OAuthSession
  // (and its DPoP keys) is held inside the OAuth client's MMKV store
  // and re-hydrated on demand via `oauthRestore(did)` at call sites
  // that need an `Agent`. Also stashes the handle for next-visit
  // pre-fill (kept across sign-out).
  signInWithDid: async (did: string, handle: string) => {
    await Promise.all([
      secureSet(DID_KEY, did),
      secureSet(LAST_HANDLE_KEY, handle),
    ]);
    set({ did, lastHandle: handle });
  },

  signOut: async () => {
    const did = get().did;
    // Best-effort server-side revocation. We swallow errors so a
    // network failure during sign-out doesn't strand the user
    // signed-in locally — the local state clear is the load-bearing
    // step, and the server-side token will eventually expire.
    if (did) {
      try {
        await oauthSignOut(did);
      } catch (err) {
        console.warn('atproto signOut revoke failed', err);
      }
    }
    await secureDelete(DID_KEY);
    set({ did: null });
  },

  hydrate: async () => {
    try {
      const [did, lastHandle] = await Promise.all([
        secureGet(DID_KEY),
        secureGet(LAST_HANDLE_KEY),
      ]);
      const next: Partial<AuthState> = { isLoading: false, lastHandle };
      if (did) {
        next.did = did;
        // Fire-and-forget: warm the OAuth client's session cache so
        // the next call to `oauthRestore(did)` from a UI surface
        // returns immediately. We intentionally don't await — cold
        // start should not block on a network round-trip.
        oauthRestore(did).catch((err) => {
          console.warn('atproto session restore failed', err);
        });
      }
      set(next);
    } catch (err) {
      console.warn('auth hydrate failed; starting signed-out', err);
      set({ isLoading: false });
    }
  },
}));
