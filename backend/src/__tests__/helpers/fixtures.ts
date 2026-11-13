// A valid app.tortok.video.post record, in the JSON form Jetstream and
// listRecords deliver, for tests to vary.

import { BSKY_POST_NSID } from '../../atproto/bskyPost';

export const INFO_HASH = 'a'.repeat(40);

export function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $type: 'app.tortok.video.post',
    magnetUri: `magnet:?xt=urn:btih:${INFO_HASH}&dn=bbb-01.mp4&ws=https%3A%2F%2Fcontent.tortok.net%2Fbbb-01.mp4`,
    infoHash: INFO_HASH,
    durationMs: 20_000,
    aspectRatio: { width: 608, height: 1080 },
    caption: 'Big Buck Bunny',
    thumbnailBlob: { $type: 'blob', ref: { $link: 'bafkthumb' }, mimeType: 'image/jpeg', size: 1234 },
    torrentBlob: { $type: 'blob', ref: { $link: 'bafktorrent' }, mimeType: 'application/x-bittorrent', size: 456 },
    hashtags: ['#bbb', '#test'],
    createdAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  };
}

/** A bridged-video candidate's video blob CID (base32 CIDv1). */
export const VIDEO_CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

/** An app.bsky.feed.post with a portrait video embed, as Jetstream delivers it. */
export function videoRecord(over: Record<string, unknown> = {}, aspectRatio: unknown = { width: 9, height: 16 }) {
  return {
    $type: 'app.bsky.feed.post',
    text: 'a clip #cats',
    createdAt: '2026-11-12T10:00:00.000Z',
    facets: [{ index: { byteStart: 7, byteEnd: 12 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'cats' }] }],
    embed: {
      $type: 'app.bsky.embed.video',
      video: { $type: 'blob', ref: { $link: VIDEO_CID }, mimeType: 'video/mp4', size: 1_000_000 },
      aspectRatio,
    },
    ...over,
  };
}

/** A record's `labels` field carrying these self-labels. */
export const selfLabelsField = (...vals: string[]) =>
  ({ $type: 'com.atproto.label.defs#selfLabels', values: vals.map((val) => ({ val })) });

/** The AT-URI of an app.bsky.feed.post. */
export const bskyPostUri = (did: string, rkey: string) => `at://${did}/${BSKY_POST_NSID}/${rkey}`;
