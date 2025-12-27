import WebTorrent from 'webtorrent';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new WebTorrent();
const torrentPath = path.join(__dirname, 'test_video.torrent');
const hlsDir = path.join(__dirname, 'hls');

console.log('🌱 Starting WebTorrent Seeder...');
console.log('📁 Seeding from:', hlsDir);

// Seed the content
client.seed(hlsDir, {
  name: 'tortok-test-video',
  announce: [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.webtorrent.dev'
  ]
}, (torrent) => {
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

// Also start an HTTP server to serve the files directly (for web seed / fallback)
const httpPort = 8081;
const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${httpPort}`);
  const filePath = path.join(hlsDir, url.pathname);

  // CORS headers for cross-origin access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  import('fs').then(fs => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Set content type
      if (filePath.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (filePath.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
      }

      res.writeHead(200);
      res.end(data);
    });
  });
});

httpServer.listen(httpPort, () => {
  console.log(`\n🌐 HTTP fallback server running at http://localhost:${httpPort}`);
  console.log(`   HLS URL: http://localhost:${httpPort}/playlist.m3u8`);
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
