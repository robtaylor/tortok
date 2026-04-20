import WebTorrent from 'webtorrent';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const httpPort = 8090;
const CLIPS = ['bbb-01', 'bbb-02', 'bbb-03', 'bbb-04', 'bbb-05'];

const client = new WebTorrent();
// 5 torrents × internal listeners per torrent exceeds Node's default 10.
client.setMaxListeners(CLIPS.length * 5);

console.log('🌱 Starting WebTorrent Seeder...');
console.log(`📁 Seeding ${CLIPS.length} clips from clips/\n`);

// Seed all clips in parallel. Track results for the summary.
let seeded = 0;
for (const name of CLIPS) {
  const videoPath = path.join(__dirname, 'clips', `${name}.mp4`);

  client.seed(videoPath, {
    // Do NOT rename via `name:` — webtorrent's fs-chunk-store resolves by the
    // torrent's logical name, so renaming it causes ENOENT when peers request
    // pieces (it tries to open `./<name>` instead of the original file).
    announce: ['ws://localhost:8000'],
    // BEP-19 webseed: HTTP fallback when no P2P peers are available.
    urlList: [`http://localhost:${httpPort}/${name}.mp4`],
  }, (torrent) => {
    // Persist magnet + .torrent per clip so clients/scripts can pick them up.
    fs.writeFileSync(
      path.join(__dirname, `${name}.magnet.txt`),
      torrent.magnetURI + '\n',
    );
    fs.writeFileSync(
      path.join(__dirname, `${name}.torrent`),
      torrent.torrentFile,
    );

    seeded++;
    console.log(`✅ [${seeded}/${CLIPS.length}] ${name}`);
    console.log(`   Hash: ${torrent.infoHash}`);
    console.log(`   Magnet: ${torrent.magnetURI.slice(0, 80)}…`);
    console.log(`   Files: ${torrent.files.map((f) => f.name).join(', ')}\n`);

    if (seeded === CLIPS.length) {
      console.log('🎉 All clips seeding. Waiting for peers…\n');
    }
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

// ---------------------------------------------------------------------------
// HTTP server — serves clips, posters, and .torrent files
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

  // Serve .torrent files — e.g. /bbb-01.torrent
  if (url?.endsWith('.torrent')) {
    const torrentPath = path.join(__dirname, url.slice(1));
    return serveFile(req, res, torrentPath, 'application/x-bittorrent');
  }

  // Serve poster images — e.g. /posters/bbb-01.jpg
  if (url?.startsWith('/posters/') && url.endsWith('.jpg')) {
    const posterPath = path.join(__dirname, url.slice(1));
    return serveFile(req, res, posterPath, 'image/jpeg');
  }

  // Legacy /poster.jpg route (single poster from before multi-clip)
  if (url === '/poster.jpg') {
    const posterPath = path.join(__dirname, 'poster.jpg');
    return serveFile(req, res, posterPath, 'image/jpeg');
  }

  // Serve video clips — e.g. /bbb-01.mp4
  if (url?.endsWith('.mp4')) {
    const videoPath = path.join(__dirname, 'clips', url.slice(1));
    return serveVideoWithRange(req, res, videoPath);
  }

  res.writeHead(404, cors);
  res.end('Not found');
});

function serveFile(req, res, filePath, contentType) {
  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      ...cors,
      'Content-Type': contentType,
      'Content-Length': stat.size,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, cors);
    res.end('Not found');
  }
}

function serveVideoWithRange(req, res, videoPath) {
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
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(videoPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': total,
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(videoPath).pipe(res);
  }
}

httpServer.listen(httpPort, () => {
  console.log(`🌐 HTTP webseed server running at http://localhost:${httpPort}`);
  console.log(`   Clips:   /bbb-01.mp4 … /bbb-05.mp4`);
  console.log(`   Posters: /posters/bbb-01.jpg … /posters/bbb-05.jpg`);
  console.log(`   Torrents: /bbb-01.torrent … /bbb-05.torrent\n`);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down…');
  client.destroy(() => {
    httpServer.close();
    process.exit(0);
  });
});

console.log('Press Ctrl+C to stop seeding.\n');
