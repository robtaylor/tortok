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
//   (Decision 0023), and only while it keeps re-reading them: a row whose
//   check is more than a day overdue is left out until it is read again
//   (Decision 0025). Their author is the `profiles` row if ingest has one for
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
  /** When the request is served; decides which bridged posts' checks are overdue. */
  now: Date;
}

/**
 * How late a bridged post's check may be before the feed leaves the post out
 * (Decision 0025). The poller checks a post at least daily, so a served post
 * was read from Bluesky no more than two days ago, whether or not the poller
 * is running. Its author's profile, where `#nobridge` is, may have been read
 * a day before that (bridgePolicy.ts, authorReadIsFresh).
 */
export const CHECK_OVERDUE_MS = 24 * 60 * 60_000;

const overdueBefore = (now: Date) => new Date(now.getTime() - CHECK_OVERDUE_MS);

// Every feed read: playable native rows and qualified bridged rows, with
// their author from either table. The first WHERE condition is
// idx_posts_feed's predicate (schema.sql), word for word, so the planner can
// walk that index in feed order: keep the two in step, and the NSIDs literals.
// The second ($1, overdueBefore) can't be in the index, because it moves with
// the clock. A bridged row with no check date fails it.
const SELECT_POSTS = `
  SELECT p.at_uri, p.did, p.collection, p.cid, p.text, p.thumbnail_cid, p.duration_ms, p.width, p.height,
         p.hashtags, p.magnet_link, p.torrent_cid, p.video_cid, p.record_created_at,
         pr.did IS NOT NULL AS has_profile, pr.handle, pr.display_name, pr.avatar_cid,
         ba.handle AS bridge_handle, ba.display_name AS bridge_display_name, ba.avatar_url AS bridge_avatar_url
    FROM posts p
    LEFT JOIN profiles pr ON pr.did = p.did
    LEFT JOIN bridge_authors ba ON ba.did = p.did
   WHERE ((p.collection = '${VIDEO_POST_NSID}' AND p.magnet_link IS NOT NULL)
       OR (p.collection = '${BSKY_POST_NSID}' AND p.bridge_qualified_at IS NOT NULL AND p.video_cid IS NOT NULL))
     AND (p.collection <> '${BSKY_POST_NSID}' OR p.bridge_next_check_at > $1)`;

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

/** A feed page's query ($1 overdue-before, $2 limit, $3 offset); exported so a test can EXPLAIN it. */
export const FEED_PAGE_SQL = `${SELECT_POSTS} ORDER BY p.record_created_at DESC, p.at_uri LIMIT $2 OFFSET $3`;

/** Newest first; ties broken by AT-URI so pages don't overlap. */
export async function feedPage(limit: number, offset: number, ctx: FeedContext): Promise<FeedItem[]> {
  const rows = await query<FeedRow>(FEED_PAGE_SQL, [overdueBefore(ctx.now), limit, offset]);
  return rows.map((r) => toFeedItem(r, ctx));
}

export async function feedItem(atUri: string, ctx: FeedContext): Promise<FeedItem | null> {
  const [row] = await query<FeedRow>(`${SELECT_POSTS} AND p.at_uri = $2`, [overdueBefore(ctx.now), atUri]);
  return row ? toFeedItem(row, ctx) : null;
}
