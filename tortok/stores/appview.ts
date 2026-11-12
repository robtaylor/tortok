import { create } from 'zustand';
import Constants from 'expo-constants';
import { MMKV } from 'react-native-mmkv';

// Which AppView the app reads its feed from (Decision 0017: clients choose
// their AppView at runtime). The user can point the app at another one from
// Profile; until they do, the build's default applies. The choice isn't
// secret, so it lives in MMKV, whose synchronous read sets it before the
// first render.

const URL_KEY = 'appviewUrl';
const settings = new MMKV({ id: 'tortok-settings' });

/** tortok's own AppView. */
export const TORTOK_APPVIEW_URL = 'https://appview.tortok.app';

/** Builds for development and e2e, which talk to local backends over http. */
const LOCAL_BUILD = __DEV__ || process.env.EXPO_PUBLIC_E2E === '1';

/**
 * The build's default AppView:
 *   1. EXPO_PUBLIC_API_URL when the build sets it (the e2e builds, a LAN
 *      backend, staging).
 *   2. In development, the backend on the machine Metro runs on: Expo's
 *      hostUri is that machine as the simulator, emulator or LAN device sees
 *      it; the backend listens on 8080. Never production, so dev builds
 *      can't touch it by accident.
 *   3. Otherwise tortok's AppView.
 */
function buildDefault(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return new URL(env).origin;
  if (__DEV__) {
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    return `http://${host || 'localhost'}:8080`;
  }
  return TORTOK_APPVIEW_URL;
}

export const DEFAULT_APPVIEW_URL = buildDefault();

export class AppViewUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppViewUrlError';
  }
}

/**
 * Parse what the user typed into an AppView origin, with no path, query or
 * fragment. Release builds require https, apart from the build's own default;
 * development and e2e builds also take http. Throws AppViewUrlError.
 */
export function parseAppViewUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppViewUrlError('Enter a full URL, such as https://appview.example.com');
  }
  const httpAllowed = LOCAL_BUILD || url.origin === DEFAULT_APPVIEW_URL;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && httpAllowed)) {
    throw new AppViewUrlError('The AppView URL must use https');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new AppViewUrlError('Enter only the AppView’s address, with no path');
  }
  return url.origin;
}

/**
 * Throws AppViewUrlError unless `base` serves a feed: the one request the
 * app makes of an AppView.
 */
async function checkServesFeed(base: string, fetchImpl: typeof fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}/videos/feed?limit=1`);
  } catch {
    throw new AppViewUrlError(`Couldn’t reach ${base}`);
  }
  const body = res.ok ? await res.json().catch(() => null) : null;
  if (!Array.isArray((body as { videos?: unknown } | null)?.videos)) {
    throw new AppViewUrlError(`${base} isn’t answering as a tortok AppView`);
  }
}

type AppViewState = {
  /** The AppView in use: the user's choice, else the build default. */
  url: string;
  /** Check, save and switch to an AppView; returns its origin. Throws AppViewUrlError. */
  setUrl: (input: string, fetchImpl?: typeof fetch) => Promise<string>;
  /** Go back to the build default. */
  reset: () => void;
};

export const useAppViewStore = create<AppViewState>((set) => ({
  url: settings.getString(URL_KEY) ?? DEFAULT_APPVIEW_URL,

  setUrl: async (input, fetchImpl = fetch) => {
    const url = parseAppViewUrl(input);
    await checkServesFeed(url, fetchImpl);
    if (url === DEFAULT_APPVIEW_URL) settings.delete(URL_KEY);
    else settings.set(URL_KEY, url);
    set({ url });
    return url;
  },

  reset: () => {
    settings.delete(URL_KEY);
    set({ url: DEFAULT_APPVIEW_URL });
  },
}));
