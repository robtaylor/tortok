import { InvalidRecordError, parseVideoPost } from '../atproto/videoPost';
import { INFO_HASH, validRecord } from './helpers/fixtures';

function rejects(record: unknown, reason: RegExp) {
  expect(() => parseVideoPost(record)).toThrow(InvalidRecordError);
  expect(() => parseVideoPost(record)).toThrow(reason);
}

describe('parseVideoPost', () => {
  it('returns the indexed fields of a valid record', () => {
    expect(parseVideoPost(validRecord())).toEqual({
      magnetUri: validRecord().magnetUri,
      infoHash: INFO_HASH,
      durationMs: 20_000,
      width: 608,
      height: 1080,
      caption: 'Big Buck Bunny',
      thumbnailCid: 'bafkthumb',
      torrentCid: 'bafktorrent',
      hashtags: ['#bbb', '#test'],
      createdAt: new Date('2026-11-10T12:00:00.000Z'),
    });
  });

  it('accepts a record with only the required fields', () => {
    const { magnetUri, infoHash, durationMs, createdAt } = validRecord();
    const post = parseVideoPost({ magnetUri, infoHash, durationMs, createdAt });
    expect(post).toMatchObject({ width: null, caption: null, thumbnailCid: null, torrentCid: null, hashtags: [] });
  });

  it('ignores fields the Lexicon no longer defines', () => {
    expect(() => parseVideoPost(validRecord({ hlsFallbackUrl: 'https://example.com/a.m3u8' }))).not.toThrow();
  });

  it.each([
    ['a non-object', 'nope', /not an object/],
    ['another $type', validRecord({ $type: 'app.bsky.feed.post' }), /\$type/],
    ['a missing magnet', validRecord({ magnetUri: undefined }), /magnetUri must be a string/],
    ['a non-magnet URI', validRecord({ magnetUri: 'https://x' }), /not a magnet/],
    ['an uppercase infoHash', validRecord({ infoHash: 'A'.repeat(40) }), /lowercase hex/],
    ['a mismatched infoHash', validRecord({ infoHash: 'b'.repeat(40) }), /disagree/],
    ['a zero duration', validRecord({ durationMs: 0 }), /durationMs/],
    ['an over-long video', validRecord({ durationMs: 600_001 }), /durationMs/],
    ['a fractional width', validRecord({ aspectRatio: { width: 1.5, height: 2 } }), /aspectRatio.width/],
    ['a long caption', validRecord({ caption: 'x'.repeat(301) }), /graphemes/],
    ['a GIF thumbnail', validRecord({ thumbnailBlob: { $type: 'blob', ref: { $link: 'c' }, mimeType: 'image/gif', size: 1 } }), /MIME/],
    ['an oversized torrent', validRecord({ torrentBlob: { $type: 'blob', ref: { $link: 'c' }, mimeType: 'application/x-bittorrent', size: 1_000_001 } }), /size/],
    ['a blob with no CID', validRecord({ torrentBlob: { $type: 'blob', ref: {}, mimeType: 'application/x-bittorrent', size: 1 } }), /no CID/],
    ['a tag without #', validRecord({ hashtags: ['bbb'] }), /begin with/],
    ['21 hashtags', validRecord({ hashtags: Array(21).fill('#a') }), /more than 20/],
    ['a bad createdAt', validRecord({ createdAt: 'yesterday' }), /createdAt/],
  ])('rejects %s', (_label, record, reason) => rejects(record, reason));

  it('counts graphemes, not UTF-16 units, for the caption', () => {
    expect(() => parseVideoPost(validRecord({ caption: '👍🏽'.repeat(300) }))).not.toThrow();
  });
});

// The validator hand-copies the Lexicon's limits; this fails if they drift.
describe('parseVideoPost matches lexicons/app/tortok/video/post.json', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lexicon = require('../../../lexicons/app/tortok/video/post.json');
  const props = lexicon.defs.main.record.properties;
  const ok = (o: Record<string, unknown>) => expect(() => parseVideoPost(validRecord(o))).not.toThrow();
  const bad = (o: Record<string, unknown>) => expect(() => parseVideoPost(validRecord(o))).toThrow(InvalidRecordError);

  it('has the same required fields', () => {
    for (const field of lexicon.defs.main.record.required) bad({ [field]: undefined });
    for (const field of Object.keys(props)) {
      if (!lexicon.defs.main.record.required.includes(field)) ok({ [field]: undefined });
    }
  });

  it('has the same durationMs range', () => {
    ok({ durationMs: props.durationMs.minimum });
    ok({ durationMs: props.durationMs.maximum });
    bad({ durationMs: props.durationMs.minimum - 1 });
    bad({ durationMs: props.durationMs.maximum + 1 });
  });

  it('has the same caption and hashtag limits', () => {
    ok({ caption: 'x'.repeat(props.caption.maxGraphemes) });
    bad({ caption: 'x'.repeat(props.caption.maxGraphemes + 1) });
    ok({ hashtags: Array(props.hashtags.maxLength).fill('#a') });
    bad({ hashtags: Array(props.hashtags.maxLength + 1).fill('#a') });
    ok({ hashtags: ['#' + 'x'.repeat(props.hashtags.items.maxGraphemes - 1)] });
    bad({ hashtags: ['#' + 'x'.repeat(props.hashtags.items.maxGraphemes)] });
  });

  it.each(['thumbnailBlob', 'torrentBlob'])('has the same %s MIME types and size limit', (field) => {
    const blob = (mimeType: string, size: number) => ({ $type: 'blob', ref: { $link: 'bafk' }, mimeType, size });
    for (const mime of props[field].accept) ok({ [field]: blob(mime, props[field].maxSize) });
    bad({ [field]: blob(props[field].accept[0], props[field].maxSize + 1) });
    bad({ [field]: blob('application/octet-stream', 1) });
  });

  it('has the same magnetUri length limit', () => {
    const base = validRecord().magnetUri as string;
    ok({ magnetUri: base + '&x='.padEnd(props.magnetUri.maxLength - base.length, 'a') });
    bad({ magnetUri: base + '&x='.padEnd(props.magnetUri.maxLength - base.length + 1, 'a') });
  });
});
