const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tortok-api.fly.dev';

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'APIError';
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new APIError(res.status, data.error || 'Request failed');
  }
  return data as T;
}

// --- Auth ---

export type AuthResponse = {
  token: string;
  user: {
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

export type Video = {
  id: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarURL: string | null;
  };
  caption: string;
  magnetLink: string | null;
  hlsURL: string | null;
  thumbnailURL: string | null;
  durationSeconds: number;
  width: number;
  height: number;
  hashtags: string[];
  likeCount: number;
  isLiked: boolean;
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

export function likeVideo(videoId: string, liked: boolean, token: string) {
  return request(`/videos/${videoId}/like`, {
    method: 'POST',
    body: { liked },
    token,
  });
}

export function recordView(
  videoId: string,
  watchedDuration: number,
  completionRate: number,
  token?: string | null,
) {
  return request(`/videos/${videoId}/view`, {
    method: 'POST',
    body: { watchedDuration, completionRate, source: 'http' },
    token,
  });
}

// --- Profile ---

export type UserProfile = {
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

export function getProfile(token: string) {
  return request<UserProfile>('/auth/me', { token });
}
