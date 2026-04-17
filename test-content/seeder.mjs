import WebTorrent from 'webtorrent';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new WebTorrent();
const videoPath = path.join(__dirname, 'clips', 'bbb-01.mp4');

console.log('🌱 Starting WebTorrent Seeder...');
console.log('📁 Seeding file:', videoPath);

// Seed the content
client.seed(videoPath, {
  // Do NOT rename via `name:` — webtorrent's fs-chunk-store resolves by the
  // torrent's logical name, so renaming it causes ENOENT when peers request
  // pieces (it tries to open `./<name>` instead of the original file).
  announce: [
    'ws://localhost:8000'
  ]
}, (torrent) => {
  // Persist the fresh magnet + .torrent so clients can pick them up
  fs.writeFileSync(path.join(__dirname, 'magnet.txt'), torrent.magnetURI + '\n');
  fs.writeFileSync(path.join(__dirname, 'test_video.torrent'), torrent.torrentFile);
  console.log('\n✅ Seeding started!');
  console.log('📊 Torrent Info:');
  console.log('   Name:', torrent.name);
  console.log('   Info Hash:', torrent.infoHash);
  console.log('   Magnet URI:', torrent.magnetURI);
  console.log('   Files:', torrent.files.length);
  torrent.files.forEach(f => {
    console.log('     -', f.name, '(' + Math.round(f.length / 1024) + ' KB)');
  });

  // Log stats periodically
  setInterval(() => {
    console.log('\n📈 Stats:');
    console.log('   Peers:', torrent.numPeers);
    console.log('   Upload Speed:', (torrent.uploadSpeed / 1024).toFixed(2), 'KB/s');
    console.log('   Downloaded:', (torrent.downloaded / 1024 / 1024).toFixed(2), 'MB');
    console.log('   Uploaded:', (torrent.uploaded / 1024 / 1024).toFixed(2), 'MB');
  }, 10000);
});

// Also start an HTTP server to serve the mp4 directly (BEP-19 webseed fallback)
const httpPort = 8090;
const httpServer = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const stat = fs.statSync(videoPath);
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
});

httpServer.listen(httpPort, () => {
  console.log(`\n🌐 HTTP fallback server running at http://localhost:${httpPort}`);
  console.log(`   Video URL: http://localhost:${httpPort}/test_video.mp4`);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  client.destroy(() => {
    httpServer.close();
    process.exit(0);
  });
});

console.log('\nPress Ctrl+C to stop seeding.');
