// Usage: node scripts/webseed-only-test.mjs <local-mirror-path> <webseed-url> <new-out-dir>
//   e.g. mirror R2 videos/test-video-2/ to /tmp/x/test-video-2, then
//   node scripts/webseed-only-test.mjs /tmp/x/test-video-2 https://<r2>/videos /tmp/x/out
// Exits 0 only if the download completes from the webseed alone and is
// byte-identical to the mirror. Uses backend/node_modules/webtorrent.
// Webseed-only download test: create a torrent from a local mirror of an
// R2 directory, then download it in a fresh client with every peer
// discovery mechanism off, so the BEP-19 webseed is the only source.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const WebTorrent = (await import(require.resolve('webtorrent'))).default;
const [srcDir, urlList, outDir] = process.argv.slice(2);
const noPeers = { dht: false, tracker: false, lsd: false, utp: false, utPex: false };

const seeder = new WebTorrent(noPeers);
const torrentFile = await new Promise((r) => seeder.seed(srcDir, { announce: [], urlList: [urlList] }, (t) => r(t.torrentFile)));
await new Promise((r) => seeder.destroy(r)); // seeder gone before the leech starts

if (fs.existsSync(outDir)) {
  console.error(`out-dir ${outDir} already exists; pass a fresh path`);
  process.exit(2);
}
const leech = new WebTorrent(noPeers);
const t0 = Date.now();
const t = leech.add(torrentFile, { path: outDir });
const timer = setTimeout(() => { console.log('FAIL timeout', { progress: t.progress, peers: t.numPeers }); process.exit(1); }, 30000);
t.on('warning', (w) => console.log('warning', String(w.message ?? w)));
t.on('error', (e) => console.log('error', String(e.message ?? e)));
t.on('done', () => {
  clearTimeout(timer);
  const same = t.files.every((f) => fs.readFileSync(path.join(outDir, f.path)).equals(fs.readFileSync(path.join(path.dirname(srcDir), f.path))));
  console.log('DONE', { ms: Date.now() - t0, pieces: t.pieces.length, bytes: t.length, wires: t.wires.map((w) => w.type), byteIdentical: same, files: t.files.map((f) => f.path) });
  leech.destroy(() => process.exit(same ? 0 : 1));
});
