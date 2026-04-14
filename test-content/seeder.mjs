import WebTorrent from 'webtorrent';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new WebTorrent();
const videoPath = path.join(__dirname, 'test_video.mp4');

console.log('🌱 Starting WebTorrent Seeder...');
console.log('📁 Seeding file:', videoPath);

// Seed the content
client.seed(videoPath, {
  name: 'tortok-test-video',
  announce: [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.webtorrent.dev'
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
  // Only serve the test video (any path returns it)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Content-Type', 'video/mp4');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  fs.readFile(videoPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
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
