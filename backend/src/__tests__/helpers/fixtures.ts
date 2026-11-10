// A valid app.tortok.video.post record, in the JSON form Jetstream and
// listRecords deliver, for tests to vary.

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
