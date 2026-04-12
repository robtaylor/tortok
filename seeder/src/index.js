import WebTorrent from 'webtorrent';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// Configuration from environment
const API_URL = process.env.API_URL || 'https://tortok-api.fly.dev';
const CONTENT_DIR = process.env.CONTENT_DIR || '/data/content';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const TRACKER_URL = process.env.TRACKER_URL || 'wss://tortok-tracker.fly.dev';
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '8080', 10);

const ANNOUNCE_LIST = [
  TRACKER_URL,
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev'
];

const client = new WebTorrent();
const seededVideos = new Map(); // videoId -> { infoHash, name }

function log(msg) {
  console.log(`[seeder] ${new Date().toISOString()} ${msg}`);
}

function err(msg) {
  console.error(`[seeder] ${new Date().toISOString()} ${msg}`);
}

// --- Content fetching from R2 ---

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(resolve); });
    }).on('error', (e) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(e);
    });
  });
}

async function downloadHLSContent(hlsUrl, videoDir) {
  // Download the playlist
  const playlistDest = path.join(videoDir, 'playlist.m3u8');
  if (fs.existsSync(playlistDest)) {
    log(`  Already cached: ${videoDir}`);
    return;
  }

  log(`  Downloading playlist from ${hlsUrl}`);
  await downloadFile(hlsUrl, playlistDest);

  // Parse playlist for segment files
  const playlist = fs.readFileSync(playlistDest, 'utf-8');
  const baseUrl = hlsUrl.substring(0, hlsUrl.lastIndexOf('/') + 1);

  const segmentLines = playlist.split('\n').filter(line =>
    line.trim() && !line.startsWith('#')
  );

  for (const segment of segmentLines) {
    const segUrl = segment.startsWith('http') ? segment : baseUrl + segment;
    const segDest = path.join(videoDir, segment);
    log(`  Downloading segment: ${segment}`);
    await downloadFile(segUrl, segDest);
  }

  log(`  Downloaded ${segmentLines.length} segments to ${videoDir}`);
}

// --- Seeding ---

function seedDirectory(dirPath, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Seeding timeout for ${name}`));
    }, 60000);

    client.seed(dirPath, { name, announce: ANNOUNCE_LIST }, (torrent) => {
      clearTimeout(timeout);
      log(`Seeding: ${torrent.name} (${torrent.infoHash})`);
      log(`  Files: ${torrent.files.length}, Peers: ${torrent.numPeers}`);

      torrent.on('wire', () => {
        log(`${torrent.name}: peer connected (${torrent.numPeers} total)`);
      });

      resolve({
        infoHash: torrent.infoHash,
        magnetURI: torrent.magnetURI,
        name: torrent.name,
        files: torrent.files.map(f => f.name)
      });
    });
  });
}

// --- Sync loop ---

async function syncVideos() {
  try {
    log('Polling API for videos...');
    const data = await fetchJSON(`${API_URL}/videos/feed?limit=100`);
    const videos = data.videos || [];
    log(`Found ${videos.length} videos in feed`);

    for (const video of videos) {
      if (seededVideos.has(video.id)) continue;
      if (!video.hlsURL) {
        log(`Skipping ${video.id}: no hlsURL`);
        continue;
      }

      const videoDir = path.join(CONTENT_DIR, video.id);
      try {
        await downloadHLSContent(video.hlsURL, videoDir);
        const info = await seedDirectory(videoDir, video.id);
        seededVideos.set(video.id, info);

        // If the video has no magnetLink yet, we could PATCH it back
        // (requires auth — deferred to L2 service integration)
        if (!video.magnetLink) {
          log(`Video ${video.id} has no magnet link — seeder-generated: ${info.magnetURI.substring(0, 60)}...`);
        }
      } catch (e) {
        err(`Failed to seed ${video.id}: ${e.message}`);
      }
    }
  } catch (e) {
    err(`Sync failed: ${e.message}`);
  }
}

// --- Seed any pre-existing local content ---

function seedLocalContent() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
    log(`Created content directory: ${CONTENT_DIR}`);
    return;
  }

  const entries = fs.readdirSync(CONTENT_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());
  log(`Found ${dirs.length} local content directories`);

  for (const entry of dirs) {
    const videoDir = path.join(CONTENT_DIR, entry.name);
    const playlistPath = path.join(videoDir, 'playlist.m3u8');

    if (fs.existsSync(playlistPath)) {
      seedDirectory(videoDir, entry.name)
        .then(info => {
          seededVideos.set(entry.name, info);
        })
        .catch(e => {
          err(`Failed to seed local ${entry.name}: ${e.message}`);
        });
    }
  }
}

// --- Health endpoint ---

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const stats = {
        status: 'ok',
        torrents: client.torrents.length,
        peers: client.torrents.reduce((sum, t) => sum + t.numPeers, 0),
        uploadSpeed: client.torrents.reduce((sum, t) => sum + t.uploadSpeed, 0),
        seededVideos: seededVideos.size
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } else if (req.url === '/torrents') {
      const torrents = client.torrents.map(t => ({
        infoHash: t.infoHash,
        name: t.name,
        numPeers: t.numPeers,
        uploadSpeed: t.uploadSpeed,
        uploaded: t.uploaded,
        files: t.files.length
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(torrents));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(HEALTH_PORT, () => {
    log(`Health server listening on port ${HEALTH_PORT}`);
  });
}

// --- Main ---

async function main() {
  log('Starting TorTok seeder');
  log(`  API: ${API_URL}`);
  log(`  Content dir: ${CONTENT_DIR}`);
  log(`  Tracker: ${TRACKER_URL}`);
  log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);

  client.on('error', (e) => {
    err(`WebTorrent error: ${e.message}`);
  });

  startHealthServer();
  seedLocalContent();

  // Initial sync
  await syncVideos();

  // Poll for new videos
  setInterval(syncVideos, POLL_INTERVAL_MS);

  log('Seeder running. Press Ctrl+C to stop.');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down...');
  client.destroy(() => {
    log('WebTorrent client destroyed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('SIGINT received, shutting down...');
  client.destroy(() => {
    log('WebTorrent client destroyed');
    process.exit(0);
  });
});

main().catch(e => {
  err(`Fatal: ${e.message}`);
  process.exit(1);
});
