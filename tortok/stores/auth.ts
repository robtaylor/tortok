import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type User = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarURL: string | null;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  videoCount: number;
};

type AuthState = {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
};

const TOKEN_KEY = 'tortok_auth_token';
const USER_KEY = 'tortok_auth_user';

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

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  signIn: async (token: string, user: User) => {
    await secureSet(TOKEN_KEY, token);
    await secureSet(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },

  signOut: async () => {
    await secureDelete(TOKEN_KEY);
    await secureDelete(USER_KEY);
    set({ token: null, user: null });
  },

  hydrate: async () => {
    try {
      const token = await secureGet(TOKEN_KEY);
      const userJson = await secureGet(USER_KEY);
      if (token && userJson) {
        set({ token, user: JSON.parse(userJson), isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
