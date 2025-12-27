import parseTorrent from 'parse-torrent';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const torrentPath = path.join(__dirname, 'test_video.torrent');

const torrentBuf = fs.readFileSync(torrentPath);
const parsed = parseTorrent(torrentBuf);

console.log('Torrent Info:');
console.log('  Name:', parsed.name);
console.log('  Info Hash:', parsed.infoHash);
console.log('  Files:');
parsed.files.forEach(f => {
  console.log('    -', f.path, '(' + Math.round(f.length / 1024) + ' KB)');
});
console.log('  Total Size:', Math.round(parsed.length / 1024 / 1024 * 100) / 100, 'MB');
console.log('  Piece Length:', parsed.pieceLength / 1024, 'KB');
console.log('  Pieces:', parsed.pieces.length);
console.log('  Trackers:', parsed.announce);

// Generate magnet link manually
const magnetLink = `magnet:?xt=urn:btih:${parsed.infoHash}&dn=${encodeURIComponent(parsed.name)}`;
console.log('\nMagnet Link:', magnetLink);

// Save to file
fs.writeFileSync(path.join(__dirname, 'magnet.txt'), magnetLink);
console.log('Saved to magnet.txt');
