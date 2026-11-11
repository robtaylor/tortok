import Constants from 'expo-constants';

// Resolution order:
//   1. Explicit EXPO_PUBLIC_API_URL — wins always (CI, staging, custom
//      LAN backend).
//   2. In dev, derive from the host Metro is reachable on. Constants.
//      expoConfig.hostUri tells us where Metro is — that's the dev
//      machine from the perspective of an iOS sim, Android emu, or
//      physical device on the LAN. Drop the Metro port (8081), use the
//      backend port (8080).
//   3. Last-resort dev fallback: localhost.
//   4. Prod: the deployed API. Env var is baked at build time; we
//      don't want a missing var to brick the app.
//
// We do NOT silently fall back to the prod URL in dev — that pattern
// caused "why does this mutate prod?" debugging sessions previously.
function getApiUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env;

  if (__DEV__) {
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const host = hostUri.split(':')[0];
      return `http://${host}:8080`;
    }
    return 'http://localhost:8080';
  }

  return 'https://tortok-api.fly.dev';
}

const API_URL = getApiUrl();

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'APIError';
  }
}

// Distinct from APIError so call sites can tell "server said no" from
// "couldn't reach the server at all" — the latter usually wants a retry
// affordance, the former usually doesn't.
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Network request failed');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new APIError(res.status, data.error || 'Request failed');
  }
  return data as T;
}

// --- Auth ---

export type User = {
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

export type AuthResponse = {
  token: string;
  user: User;
};

export function login(email: string, password: string) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export function register(data: {
  email: string;
  username: string;
  displayName: string;
  password: string;
}) {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: data,
  });
}

// --- Feed ---

/** Extra webseeds and trackers from the AppView, beyond the magnet's own (Decision 0022). */
export type Sources = {
  webseeds: string[];
  trackers: string[];
};

/** How a post plays: over WebTorrent from its magnet, `.torrent` and extra sources. */
export type TorrentPlayback = {
  kind: 'torrent';
  magnetLink: string;
  /** The post's `.torrent` on the AppView's blob route; lets it start with no peer. */
  torrentFileUrl: string | null;
  sources: Sources;
};

/** An indexed `app.tortok.video.post`, as GET /videos/feed serves it. */
export type Video = {
  /** The record's AT-URI. */
  id: string;
  cid: string;
  author: {
    did: string;
    /** Null when the handle doesn't verify. */
    handle: string | null;
    displayName: string | null;
    avatarURL: string | null;
  };
  caption: string;
  playback: TorrentPlayback;
  posterURL: string | null;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  /** Each begins with '#'. */
  hashtags: string[];
  createdAt: string;
};

export type FeedResponse = {
  videos: Video[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function getFeed(token?: string | null, cursor?: string) {
  const params = new URLSearchParams();
  params.set('limit', '10');
  if (cursor) params.set('offset', cursor);
  return request<FeedResponse>(`/videos/feed?${params}`, { token });
}

/** How to show an author: their verified handle, else their display name, else their DID. */
export function authorLabel(author: Video['author']): string {
  if (author.handle) return `@${author.handle}`;
  return author.displayName || author.did;
}

// --- Profile ---

export function getProfile(token: string) {
  return request<User>('/auth/me', { token });
}
