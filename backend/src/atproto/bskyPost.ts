// Which `app.bsky.feed.post` records the bridge indexes (Decisions 0010 and
// 0023): posts with a video embed, alone or inside recordWithMedia, with an
// aspect ratio no wider than the configured minimum (portrait or square by
// default). Everything else, including malformed records, is not a
// candidate; the bridge doesn't index it and doesn't log it, since most of
// the stream isn't video.
//
// Playback is Bluesky's HLS playlist for the video blob (Decision 0010),
// built from the video CID when the feed is read (hlsUrl, thumbnailUrl), so
// the CID must be a plain base32 CIDv1.

import { bridgeVideoBase } from '../config';
import { isObject } from './videoPost';

export const BSKY_POST_NSID = 'app.bsky.feed.post';

export interface BskyVideoPost {
  videoCid: string;
  width: number;
  height: number;
  text: string | null;
  hashtags: string[];
  createdAt: Date;
}

export type Rejection =
  | 'no-video' | 'no-aspect-ratio' | 'too-wide' | 'bad-video-blob' | 'bad-created-at';

const CID_RE = /^b[a-z2-7]{20,}$/;
// app.bsky.feed.post caps text at 3,000 bytes; anything longer is malformed.
const MAX_TEXT = 3000;
const MAX_TAGS = 20;
const MAX_TAG = 64;

// Bluesky's video service, as its AppView's app.bsky.embed.video#view names
// it: the playlist and thumbnail for a video blob. The e2e stack points
// BRIDGE_VIDEO_BASE at its own content server.
const videoBase = (did: string, videoCid: string) =>
  `${bridgeVideoBase()}/${encodeURIComponent(did)}/${videoCid}`;
export const hlsUrl = (did: string, videoCid: string) => `${videoBase(did, videoCid)}/playlist.m3u8`;
export const thumbnailUrl = (did: string, videoCid: string) => `${videoBase(did, videoCid)}/thumbnail.jpg`;

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Tags from the record's `tags` and its facets' #tag features, '#'-prefixed, deduplicated. */
function hashtags(record: Record<string, unknown>): string[] {
  const raw: unknown[] = Array.isArray(record.tags) ? [...record.tags] : [];
  if (Array.isArray(record.facets)) {
    for (const f of record.facets) {
      if (!isObject(f) || !Array.isArray(f.features)) continue;
      for (const feat of f.features) {
        if (isObject(feat) && feat.$type === 'app.bsky.richtext.facet#tag') raw.push(feat.tag);
      }
    }
  }
  const tags = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.replace(/^#/, '');
    if (tag.length > 0 && tag.length <= MAX_TAG) tags.add(`#${tag}`);
    if (tags.size === MAX_TAGS) break;
  }
  return [...tags];
}

/**
 * The parts of a bridged video post the index stores, or why it isn't one.
 * `aspectMin` is the minimum height/width; `now` clamps a future createdAt,
 * which would otherwise pin the post to the top of a chronological feed.
 */
export function parseBskyVideoPost(
  did: string, record: unknown, aspectMin: number, now = new Date(),
): BskyVideoPost | Rejection {
  if (!isObject(record) || !isObject(record.embed)) return 'no-video';
  const embed = record.embed.$type === 'app.bsky.embed.recordWithMedia' ? record.embed.media : record.embed;
  if (!isObject(embed) || embed.$type !== 'app.bsky.embed.video') return 'no-video';

  const ar = embed.aspectRatio;
  if (!isObject(ar) || !positiveInt(ar.width) || !positiveInt(ar.height)) return 'no-aspect-ratio';
  if (ar.height / ar.width < aspectMin) return 'too-wide';

  const video = embed.video;
  const cid = isObject(video) && isObject(video.ref) ? video.ref.$link : undefined;
  if (typeof cid !== 'string' || !CID_RE.test(cid)) return 'bad-video-blob';

  const createdAt = typeof record.createdAt === 'string' ? new Date(record.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return 'bad-created-at';

  const text = typeof record.text === 'string' && record.text.length > 0
    ? record.text.slice(0, MAX_TEXT) : null;

  return {
    videoCid: cid,
    width: ar.width,
    height: ar.height,
    text,
    hashtags: hashtags(record),
    createdAt: createdAt > now ? now : createdAt,
  };
}
