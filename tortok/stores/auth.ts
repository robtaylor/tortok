import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { User } from '@/lib/api';
import {
  restore as oauthRestore,
  signOut as oauthSignOut,
} from '@/lib/atproto/oauth';

// Phase 3 Unit 2 (option b in plans/squishy-stargazing-hopcroft.md):
// `did` is the new atproto identity. `token` + `user` remain for
// legacy backend compat during the Unit 2 → 3 transition; Unit 5
// removes them once the legacy email/password and feed endpoints
// are retired.
type AuthState = {
  token: string | null;
  user: User | null;
  did: string | null;
  isLoading: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signInWithDid: (did: string) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
};

const TOKEN_KEY = 'tortok_auth_token';
const USER_KEY = 'tortok_auth_user';
const DID_KEY = 'tortok_auth_did';

// On web, expo-secure-store falls back to localStorage, which is readable
// by any XSS on the domain. Tokens stored here are effectively bearer
// credentials exposed to script injection. See ADR-006 Phase 3 for the
// planned migration to HttpOnly session cookies.
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
  token: null,
  user: null,
  did: null,
  isLoading: true,

  // Legacy email/password sign-in. Removed in Unit 5 along with the
  // backend's `routes/auth.ts`. Kept here so callers that still hit
  // the legacy endpoint compile during the Unit 2 → 3 transition.
  signIn: async (token: string, user: User) => {
    await Promise.all([
      secureSet(TOKEN_KEY, token),
      secureSet(USER_KEY, JSON.stringify(user)),
    ]);
    set({ token, user });
  },

  // atproto OAuth sign-in. Persists only the DID; the live OAuthSession
  // (and its DPoP keys) is held inside the OAuth client's MMKV store
  // and re-hydrated on demand via `oauthRestore(did)` at call sites
  // that need an `Agent`.
  signInWithDid: async (did: string) => {
    await secureSet(DID_KEY, did);
    set({ did });
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
    await Promise.all([
      secureDelete(TOKEN_KEY),
      secureDelete(USER_KEY),
      secureDelete(DID_KEY),
    ]);
    set({ token: null, user: null, did: null });
  },

  hydrate: async () => {
    try {
      const [token, userJson, did] = await Promise.all([
        secureGet(TOKEN_KEY),
        secureGet(USER_KEY),
        secureGet(DID_KEY),
      ]);
      const next: Partial<AuthState> = { isLoading: false };
      if (token && userJson) {
        next.token = token;
        next.user = JSON.parse(userJson);
      }
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
