const createTorrent = require('create-torrent');
const fs = require('fs');
const path = require('path');
const parseTorrent = require('parse-torrent');

// WebTorrent-compatible trackers
const WEBTORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev'
];

const hlsDir = path.join(__dirname, 'hls');
const outputPath = path.join(__dirname, 'test_video.torrent');

console.log('Creating torrent from:', hlsDir);

createTorrent(hlsDir, {
  name: 'tortok-test-video',
  comment: 'TorTok test video - HLS segments',
  createdBy: 'TorTok',
  announceList: [WEBTORRENT_TRACKERS],
  urlList: [], // Can add web seeds later
}, (err, torrent) => {
  if (err) {
    console.error('Error creating torrent:', err);
    process.exit(1);
  }

  // Write torrent file
  fs.writeFileSync(outputPath, torrent);
  console.log('Torrent file created:', outputPath);

  // Parse and display info
  const parsed = parseTorrent(torrent);
  console.log('\nTorrent Info:');
  console.log('  Name:', parsed.name);
  console.log('  Info Hash:', parsed.infoHash);
  console.log('  Magnet Link:', parseTorrent.toMagnetURI(parsed));
  console.log('  Files:');
  parsed.files.forEach(f => {
    console.log('    -', f.name, '(' + Math.round(f.length / 1024) + ' KB)');
  });
  console.log('  Total Size:', Math.round(parsed.length / 1024 / 1024 * 100) / 100, 'MB');
  console.log('  Piece Length:', parsed.pieceLength / 1024, 'KB');
  console.log('  Pieces:', parsed.pieces.length);

  // Save magnet link to file
  const magnetPath = path.join(__dirname, 'magnet.txt');
  fs.writeFileSync(magnetPath, parseTorrent.toMagnetURI(parsed));
  console.log('\nMagnet link saved to:', magnetPath);
});
