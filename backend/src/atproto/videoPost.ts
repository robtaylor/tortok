// Validation for `app.tortok.video.post` records
// (lexicons/app/tortok/video/post.json). Records are public and anyone can
// write one, so ingest validates every record before indexing it.
//
// Hand-written for this one record type rather than pulling in
// @atproto/lexicon; keep it in step with the Lexicon file.

export const VIDEO_POST_NSID = 'app.tortok.video.post';

/** The parts of a valid record that the index stores. */
export interface VideoPost {
  magnetUri: string;
  infoHash: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  thumbnailCid: string | null;
  torrentCid: string | null;
  hashtags: string[];
  createdAt: Date;
}

export class InvalidRecordError extends Error {
  constructor(reason: string) {
    super(`invalid ${VIDEO_POST_NSID} record: ${reason}`);
    this.name = 'InvalidRecordError';
  }
}

const INFO_HASH_RE = /^[0-9a-f]{40}$/;
const MAGNET_BTIH_RE = /[?&]xt=urn:btih:([0-9a-fA-F]{40})(?:&|$)/;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemeCount(s: string): number {
  let n = 0;
  for (const _ of graphemes.segment(s)) n++;
  return n;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(reason: string): never {
  throw new InvalidRecordError(reason);
}

function str(v: unknown, field: string, maxLength: number, maxGraphemes?: number): string {
  if (typeof v !== 'string') fail(`${field} must be a string`);
  if (v.length > maxLength) fail(`${field} is longer than ${maxLength}`);
  if (maxGraphemes !== undefined && graphemeCount(v) > maxGraphemes) {
    fail(`${field} has more than ${maxGraphemes} graphemes`);
  }
  return v;
}

function int(v: unknown, field: string, min: number, max?: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${field} must be an integer`);
  if (v < min || (max !== undefined && v > max)) fail(`${field} is out of range`);
  return v;
}

/**
 * A blob reference in its JSON form, as Jetstream and listRecords return it:
 * `{ $type: 'blob', ref: { $link: cid }, mimeType, size }`. Returns the CID.
 */
function blobCid(v: unknown, field: string, accept: readonly string[], maxSize: number): string {
  if (!isObject(v) || v.$type !== 'blob') fail(`${field} must be a blob`);
  const ref = v.ref;
  if (!isObject(ref) || typeof ref.$link !== 'string' || ref.$link.length === 0) {
    fail(`${field} has no CID`);
  }
  if (typeof v.mimeType !== 'string' || !accept.includes(v.mimeType)) {
    fail(`${field} has MIME type ${String(v.mimeType)}`);
  }
  int(v.size, `${field}.size`, 0, maxSize);
  return ref.$link;
}

/** Parse and validate a record. Throws InvalidRecordError. */
export function parseVideoPost(record: unknown): VideoPost {
  if (!isObject(record)) fail('not an object');
  if (record.$type !== undefined && record.$type !== VIDEO_POST_NSID) {
    fail(`$type is ${String(record.$type)}`);
  }

  const magnetUri = str(record.magnetUri, 'magnetUri', 8192);
  if (!magnetUri.startsWith('magnet:?')) fail('magnetUri is not a magnet URI');
  const infoHash = str(record.infoHash, 'infoHash', 40);
  if (!INFO_HASH_RE.test(infoHash)) fail('infoHash must be 40 lowercase hex characters');
  const btih = MAGNET_BTIH_RE.exec(magnetUri)?.[1];
  if (!btih) fail('magnetUri has no hex btih info hash');
  if (btih.toLowerCase() !== infoHash) fail('magnetUri and infoHash disagree');

  const durationMs = int(record.durationMs, 'durationMs', 1, 600_000);

  let width: number | null = null;
  let height: number | null = null;
  if (record.aspectRatio !== undefined) {
    if (!isObject(record.aspectRatio)) fail('aspectRatio must be an object');
    width = int(record.aspectRatio.width, 'aspectRatio.width', 1);
    height = int(record.aspectRatio.height, 'aspectRatio.height', 1);
  }

  const caption = record.caption === undefined ? null : str(record.caption, 'caption', 1200, 300);

  const thumbnailCid = record.thumbnailBlob === undefined
    ? null
    : blobCid(record.thumbnailBlob, 'thumbnailBlob', ['image/jpeg', 'image/png', 'image/webp'], 1_000_000);
  const torrentCid = record.torrentBlob === undefined
    ? null
    : blobCid(record.torrentBlob, 'torrentBlob', ['application/x-bittorrent'], 1_000_000);

  let hashtags: string[] = [];
  if (record.hashtags !== undefined) {
    if (!Array.isArray(record.hashtags)) fail('hashtags must be an array');
    if (record.hashtags.length > 20) fail('more than 20 hashtags');
    hashtags = record.hashtags.map((h, i) => {
      const tag = str(h, `hashtags[${i}]`, 256, 64);
      if (!tag.startsWith('#')) fail(`hashtags[${i}] doesn't begin with '#'`);
      return tag;
    });
  }

  const createdAtRaw = str(record.createdAt, 'createdAt', 64);
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) fail('createdAt is not a datetime');

  return {
    magnetUri, infoHash, durationMs, width, height, caption,
    thumbnailCid, torrentCid, hashtags, createdAt,
  };
}
