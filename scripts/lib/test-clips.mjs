// scripts/lib/test-clips.mjs
//
// The five Big Buck Bunny test clips (CC-BY 3.0, see
// test-content/clips/CREDITS.md) and the one way their torrents are built.
// upload-test-clips.mjs and seed-fixtures.mjs both use it, so the
// infohashes in the records always match the clips on R2.

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

// Pinned exactly in the root package.json: another create-torrent version
// could build different torrents, and so different infohashes, for the
// clips already published.
import createTorrent from 'create-torrent';
import parseTorrent, { toMagnetURI } from 'parse-torrent';

export const CONTENT_DIR = new URL('../../test-content/', import.meta.url).pathname;

// The same names and production values as backend/fly.toml.
export const TRACKERS = (process.env.TRACKER_URLS ?? 'wss://tortok-tracker.fly.dev')
  .split(',').map((u) => u.trim()).filter(Boolean);
export const PUBLIC_URL = (process.env.CONTENT_ORIGIN_URL ?? 'https://content.tortok.net').replace(/\/$/, '');
export const PREFIX = process.env.R2_PREFIX ?? 'test-content';

// Must match test-content/make-test-clips.sh output.
export const CLIPS = [
  { name: 'bbb-01', title: 'Big Buck Bunny — opening shot' },
  { name: 'bbb-02', title: 'Big Buck Bunny — butterfly scene' },
  { name: 'bbb-03', title: 'Big Buck Bunny — the chase' },
  { name: 'bbb-04', title: 'Big Buck Bunny — squirrel tricks' },
  { name: 'bbb-05', title: 'Big Buck Bunny — finale' },
];
export const CLIP_META = { durationMs: 20_000, width: 608, height: 1080, tags: ['bbb', 'test'] };

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Local file paths, R2 key and public URL for a clip. Throws if a local file is missing. */
export function clipFiles(clip) {
  const clipPath = path.join(CONTENT_DIR, 'clips', `${clip.name}.mp4`);
  const posterPath = path.join(CONTENT_DIR, 'posters', `${clip.name}.jpg`);
  for (const f of [clipPath, posterPath]) if (!fs.existsSync(f)) throw new Error(`missing input file ${f}`);
  // An empty R2_PREFIX puts the files at the origin's root (the e2e
  // stack's content server serves /<name>.mp4).
  const clipKey = PREFIX ? `${PREFIX}/${clip.name}.mp4` : `${clip.name}.mp4`;
  return { clipPath, posterPath, clipKey, clipUrl: `${PUBLIC_URL}/${clipKey}` };
}

/**
 * Build a clip's single-file torrent: tortok's trackers only, and a BEP-19
 * webseed that is the file's own R2 URL. No `name:` option, so the name stays
 * the file's basename. Returns the .torrent bytes, infohash and magnet.
 */
export async function buildClipTorrent(clipPath, clipUrl) {
  if (TRACKERS.length === 0) throw new Error('TRACKER_URLS contains no tracker URLs');
  const torrentBuf = await promisify(createTorrent)(clipPath, { announceList: [TRACKERS], urlList: [clipUrl] });
  const parsed = await parseTorrent(torrentBuf);
  if (!parsed.urlList?.includes(clipUrl) || !TRACKERS.every((t) => parsed.announce?.includes(t))) {
    throw new Error(`${clipPath}: torrent is missing its webseed or tracker`);
  }
  return { torrentBuf, infoHash: parsed.infoHash, magnet: toMagnetURI(parsed) };
}
