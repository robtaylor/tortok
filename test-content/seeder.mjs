// The local content server: the webseed origin for the test clips on
// :8090, and a WebTorrent seeder for them on the local tracker. It seeds the
// torrents scripts/lib/test-clips.mjs builds, the same ones seed-fixtures.mjs
// publishes, so the infohashes always match. Posters and .torrent files
// travel as PDS blobs (Decision 0020); this server doesn't serve them.
//
// It also stands in for Bluesky's video service for the e2e stack's bridged
// post (Decision 0010): /hls/<did>/<cid>/<file> serves hls/<file>, the HLS
// fixture make-hls-fixture.sh builds, whatever the DID and CID.

import WebTorrent from 'webtorrent';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { CLIPS, CLIPS_DIR, buildClipTorrent, clipFiles } from '../scripts/lib/test-clips.mjs';

// scripts/e2e-up.sh passes seed-fixtures.mjs these same two values
// (TRACKER_URLS, CONTENT_ORIGIN_URL); keep them in step, or the published
// magnets name a tracker this seeder doesn't announce to.
const LOCAL_TRACKERS = ['ws://localhost:8000'];
const httpPort = 8090;
const HLS_DIR = fileURLToPath(new URL('hls/', import.meta.url));
const HLS_TYPES = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.jpg': 'image/jpeg' };

// ---------------------------------------------------------------------------
// HTTP server — the clips' webseed, with Range support
// ---------------------------------------------------------------------------

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Cache-Control',
};

const httpServer = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const url = req.url?.split('?')[0]; // strip query string

  // Serve video clips — e.g. /bbb-01.mp4
  if (url?.endsWith('.mp4')) {
    return serveFile(req, res, path.join(CLIPS_DIR, path.basename(url)), 'video/mp4');
  }

  // Bridged-video stand-in — e.g. /hls/did%3Aplc%3Ax/bafy…/playlist.m3u8
  const hlsType = url?.startsWith('/hls/') && HLS_TYPES[path.extname(url)];
  if (hlsType) return serveFile(req, res, path.join(HLS_DIR, path.basename(url)), hlsType);

  res.writeHead(404, cors);
  res.end('Not found');
});

/** Serve a file, with Range support (BEP 19 webseeds fetch pieces by range). */
function serveFile(req, res, videoPath, type) {
  let stat;
  try {
    stat = fs.statSync(videoPath);
  } catch {
    res.writeHead(404, cors);
    res.end('Not found');
    return;
  }

  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : total - 1;
    res.writeHead(206, {
      ...cors,
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...cors,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': total,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(videoPath).pipe(res);
  }
}

// The webseed doesn't depend on the torrents, so it starts first.
httpServer.listen(httpPort, () => {
  console.log(`🌐 HTTP webseed server running at http://localhost:${httpPort}`);
  console.log(`   Clips: /${CLIPS[0].name}.mp4 … /${CLIPS.at(-1).name}.mp4\n`);
});

// ---------------------------------------------------------------------------
// WebTorrent seeder
// ---------------------------------------------------------------------------

const client = new WebTorrent();
// 5 torrents × internal listeners per torrent exceeds Node's default 10.
client.setMaxListeners(CLIPS.length * 5);

console.log('🌱 Starting WebTorrent Seeder...');
console.log(`📁 Seeding ${CLIPS.length} clips from clips/\n`);

// Build each clip's torrent, then add it. WebTorrent verifies the file
// against the pieces and seeds it; the torrents verify concurrently.
let seeded = 0;
for (const clip of CLIPS) {
  const { clipPath } = clipFiles(clip);
  const { torrentBuf } = await buildClipTorrent(
    clipPath, `http://localhost:${httpPort}/${path.basename(clipPath)}`, LOCAL_TRACKERS,
  );
  // The torrent names the file by its basename, so `path` is its directory.
  client.add(torrentBuf, { path: CLIPS_DIR }, (torrent) => {
    const report = () => {
      seeded++;
      console.log(`✅ [${seeded}/${CLIPS.length}] ${clip.name}`);
      console.log(`   Hash: ${torrent.infoHash}\n`);
      if (seeded === CLIPS.length) {
        console.log('🎉 All clips seeding. Waiting for peers…\n');
      }
    };
    if (torrent.done) report(); else torrent.once('done', report);
  });
}

// Aggregate stats every 10s.
setInterval(() => {
  const torrents = client.torrents;
  if (torrents.length === 0) return;
  const totalPeers = torrents.reduce((s, t) => s + t.numPeers, 0);
  const totalUp = torrents.reduce((s, t) => s + t.uploaded, 0);
  console.log(
    `📈 ${torrents.length} torrents | ${totalPeers} peers | ` +
    `↑ ${(totalUp / 1024 / 1024).toFixed(2)} MB total`,
  );
}, 10_000);

// Graceful shutdown on Ctrl+C (SIGINT) and scripts/dev-down.sh (SIGTERM),
// with a hard deadline so a stuck destroy can't hang the process.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 ${signal} — shutting down…`);
  setTimeout(() => process.exit(1), 5000).unref();
  httpServer.close();
  client.destroy(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('Press Ctrl+C to stop seeding.\n');
