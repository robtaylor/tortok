// The feed's view of an indexed post (Phase 3 Units 2.5B and 2.5D): a `posts`
// row joined with its author, shaped for the client. Two kinds of post:
//
// - Native `app.tortok.video.post` rows play over WebTorrent (`playback.kind
//   'torrent'`). Blob CIDs (poster, avatar, .torrent) become URLs on this
//   AppView's blob route, `${blobBase}/blob/<did>/<cid>`, and
//   `playback.sources` lists extra webseeds and trackers beyond the magnet's
//   own (Decision 0022): this AppView's trackers always, and webseeds only
//   where it knows a copy exists, which is none yet.
// - Bridged `app.bsky.feed.post` rows play from Bluesky's HLS playlist
//   (`playback.kind 'hls'`, Decision 0010), with Bluesky's thumbnail as the
//   poster, both built from the video CID (bskyPost.ts) so the URL scheme
//   lives in one place. Only rows the engagement poller has qualified are served
//   (Decision 0023). Their author is the `profiles` row if ingest has one for
//   the DID (a tortok author who also posts on Bluesky), else the bridge's
//   `bridge_authors` row, with Bluesky's CDN avatar.
//
// `id` is always the record's AT-URI; its collection tells the two apart.

import { query } from '../db';
import { VIDEO_POST_NSID } from '../atproto/videoPost';
import { BSKY_POST_NSID, hlsUrl, thumbnailUrl } from '../atproto/bskyPost';

interface FeedRow {
  at_uri: string;
  did: string;
  collection: string;
  cid: string;
  text: string | null;
  thumbnail_cid: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  hashtags: string[] | null;
  magnet_link: string | null;
  torrent_cid: string | null;
  video_cid: string | null;
  record_created_at: Date;
  has_profile: boolean;
  handle: string | null;
  display_name: string | null;
  avatar_cid: string | null;
  bridge_handle: string | null;
  bridge_display_name: string | null;
  bridge_avatar_url: string | null;
}

export interface Sources {
  webseeds: string[];
  trackers: string[];
}

export interface TorrentPlayback {
  kind: 'torrent';
  magnetLink: string;
  torrentFileUrl: string | null;
  sources: Sources;
}

/** A bridged Bluesky post: plays its HLS playlist over plain HTTP, no P2P (Decision 0010). */
export interface HlsPlayback {
  kind: 'hls';
  url: string;
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
  playback: TorrentPlayback | HlsPlayback;
  posterURL: string | null;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hashtags: string[];
  createdAt: string;
}

export interface FeedContext {
  /** Origin the blob route is served from, e.g. https://appview.tortok.app. */
  blobBase: string;
  trackers: string[];
}

// Every feed read: playable native rows and qualified bridged rows, with
// their author from either table. The WHERE clause is idx_posts_feed's
// predicate (schema.sql), word for word, so the planner can walk that index
// in feed order: keep the two in step, and the NSIDs literals.
const SELECT_POSTS = `
  SELECT p.at_uri, p.did, p.collection, p.cid, p.text, p.thumbnail_cid, p.duration_ms, p.width, p.height,
         p.hashtags, p.magnet_link, p.torrent_cid, p.video_cid, p.record_created_at,
         pr.did IS NOT NULL AS has_profile, pr.handle, pr.display_name, pr.avatar_cid,
         ba.handle AS bridge_handle, ba.display_name AS bridge_display_name, ba.avatar_url AS bridge_avatar_url
    FROM posts p
    LEFT JOIN profiles pr ON pr.did = p.did
    LEFT JOIN bridge_authors ba ON ba.did = p.did
   WHERE ((p.collection = '${VIDEO_POST_NSID}' AND p.magnet_link IS NOT NULL)
       OR (p.collection = '${BSKY_POST_NSID}' AND p.bridge_qualified_at IS NOT NULL AND p.video_cid IS NOT NULL))`;

function toFeedItem(row: FeedRow, ctx: FeedContext): FeedItem {
  const blob = (cid: string | null) => (cid ? `${ctx.blobBase}/blob/${row.did}/${cid}` : null);
  const bridged = row.collection === BSKY_POST_NSID;
  return {
    id: row.at_uri,
    cid: row.cid,
    // A profiles row wins; the bridge_authors join only applies without one.
    author: row.has_profile || !bridged
      ? { did: row.did, handle: row.handle, displayName: row.display_name, avatarURL: blob(row.avatar_cid) }
      : { did: row.did, handle: row.bridge_handle, displayName: row.bridge_display_name, avatarURL: row.bridge_avatar_url },
    caption: row.text ?? '',
    playback: bridged
      ? { kind: 'hls', url: hlsUrl(row.did, row.video_cid!) }
      : {
        kind: 'torrent',
        magnetLink: row.magnet_link!,
        torrentFileUrl: blob(row.torrent_cid),
        sources: { webseeds: [], trackers: ctx.trackers },
      },
    posterURL: bridged ? thumbnailUrl(row.did, row.video_cid!) : blob(row.thumbnail_cid),
    durationSeconds: row.duration_ms != null ? row.duration_ms / 1000 : 0,
    width: row.width,
    height: row.height,
    hashtags: row.hashtags ?? [],
    createdAt: row.record_created_at.toISOString(),
  };
}

/** A feed page's query ($1 limit, $2 offset); exported so a test can EXPLAIN it. */
export const FEED_PAGE_SQL = `${SELECT_POSTS} ORDER BY p.record_created_at DESC, p.at_uri LIMIT $1 OFFSET $2`;

/** Newest first; ties broken by AT-URI so pages don't overlap. */
export async function feedPage(limit: number, offset: number, ctx: FeedContext): Promise<FeedItem[]> {
  const rows = await query<FeedRow>(FEED_PAGE_SQL, [limit, offset]);
  return rows.map((r) => toFeedItem(r, ctx));
}

export async function feedItem(atUri: string, ctx: FeedContext): Promise<FeedItem | null> {
  const [row] = await query<FeedRow>(`${SELECT_POSTS} AND p.at_uri = $1`, [atUri]);
  return row ? toFeedItem(row, ctx) : null;
}
