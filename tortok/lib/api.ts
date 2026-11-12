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

/**
 * GET from an AppView: callers pass the one the user chose
 * (stores/appview.ts), so a query's cache key and its request name the same
 * AppView. Its API is read-only: writes go to the user's PDS.
 */
async function request<T>(base: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`);
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Network request failed');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new APIError(res.status, data.error || 'Request failed');
  }
  return data as T;
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

/** How a post plays. Bridged Bluesky posts (Phase 3 Unit 2.5D) add an HLS kind. */
export type Playback = TorrentPlayback;

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
  playback: Playback;
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

export function getFeed(appView: string, cursor?: string) {
  const params = new URLSearchParams();
  params.set('limit', '10');
  if (cursor) params.set('offset', cursor);
  return request<FeedResponse>(appView, `/videos/feed?${params}`);
}

/** The post's torrent, or null if it doesn't play over WebTorrent. */
export function torrentOf(video: Video): TorrentPlayback | null {
  return video.playback.kind === 'torrent' ? video.playback : null;
}

/** How to show an author: their verified handle, else their display name, else their DID. */
export function authorLabel(author: Video['author']): string {
  if (author.handle) return `@${author.handle}`;
  return author.displayName || author.did;
}
