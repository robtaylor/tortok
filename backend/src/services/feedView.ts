// The feed's view of an indexed post (Phase 3 Unit 2.5B): a `posts` row
// joined with its author's `profiles` row, shaped for the client.
//
// - `id` is the record's AT-URI.
// - Blob CIDs (poster, avatar, .torrent) become URLs on this AppView's blob
//   route, `${blobBase}/blob/<did>/<cid>`.
// - `playback.sources` lists extra webseeds and trackers beyond the
//   magnet's own (Decision 0022): this AppView's trackers always, and
//   webseeds only where it knows a copy exists, which is none yet.

import { query } from '../db';
import { VIDEO_POST_NSID } from '../atproto/videoPost';

interface FeedRow {
  at_uri: string;
  did: string;
  cid: string;
  text: string | null;
  thumbnail_cid: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  hashtags: string[] | null;
  magnet_link: string;
  torrent_cid: string | null;
  record_created_at: Date;
  handle: string | null;
  display_name: string | null;
  avatar_cid: string | null;
}

export interface Sources {
  webseeds: string[];
  trackers: string[];
}

export interface FeedItem {
  id: string;
  cid: string;
  author: {
    did: string;
    /** Null when the handle doesn't verify both ways. */
    handle: string | null;
    displayName: string | null;
    avatarURL: string | null;
  };
  caption: string;
  playback: {
    kind: 'torrent';
    magnetLink: string;
    torrentFileUrl: string | null;
    sources: Sources;
  };
  posterURL: string | null;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hashtags: string[];
  createdAt: string;
}

export interface FeedContext {
  /** Origin the blob route is served from, e.g. https://tortok-api.fly.dev. */
  blobBase: string;
  trackers: string[];
}

// Every feed read: playable app.tortok.video.post rows with their author.
const SELECT_POSTS = `
  SELECT p.at_uri, p.did, p.cid, p.text, p.thumbnail_cid, p.duration_ms, p.width, p.height,
         p.hashtags, p.magnet_link, p.torrent_cid, p.record_created_at,
         pr.handle, pr.display_name, pr.avatar_cid
    FROM posts p LEFT JOIN profiles pr ON pr.did = p.did
   WHERE p.collection = $1 AND p.magnet_link IS NOT NULL`;

function toFeedItem(row: FeedRow, ctx: FeedContext): FeedItem {
  const blob = (cid: string | null) => (cid ? `${ctx.blobBase}/blob/${row.did}/${cid}` : null);
  return {
    id: row.at_uri,
    cid: row.cid,
    author: {
      did: row.did,
      handle: row.handle,
      displayName: row.display_name,
      avatarURL: blob(row.avatar_cid),
    },
    caption: row.text ?? '',
    playback: {
      kind: 'torrent',
      magnetLink: row.magnet_link,
      torrentFileUrl: blob(row.torrent_cid),
      sources: { webseeds: [], trackers: ctx.trackers },
    },
    posterURL: blob(row.thumbnail_cid),
    durationSeconds: row.duration_ms != null ? row.duration_ms / 1000 : 0,
    width: row.width,
    height: row.height,
    hashtags: row.hashtags ?? [],
    createdAt: row.record_created_at.toISOString(),
  };
}

/** Newest first; ties broken by AT-URI so pages don't overlap. */
export async function feedPage(limit: number, offset: number, ctx: FeedContext): Promise<FeedItem[]> {
  const rows = await query<FeedRow>(
    `${SELECT_POSTS} ORDER BY p.record_created_at DESC, p.at_uri LIMIT $2 OFFSET $3`,
    [VIDEO_POST_NSID, limit, offset],
  );
  return rows.map((r) => toFeedItem(r, ctx));
}

export async function feedItem(atUri: string, ctx: FeedContext): Promise<FeedItem | null> {
  const [row] = await query<FeedRow>(`${SELECT_POSTS} AND p.at_uri = $2`, [VIDEO_POST_NSID, atUri]);
  return row ? toFeedItem(row, ctx) : null;
}
