import path from 'path';
import fs from 'fs';
import { envOrDevDefault, trackerUrls } from '../config';

interface TorrentInfo {
  infoHash: string;
  magnetURI: string;
  name: string;
  files: string[];
}

// WebTorrent types (since it's ESM)
interface WebTorrentInstance {
  seed: (input: string, opts: any, callback: (torrent: any) => void) => void;
  torrents: any[];
  destroy: (callback: () => void) => void;
  on: (event: string, callback: (...args: any[]) => void) => void;
}

class SeederService {
  private client: WebTorrentInstance | null = null;
  private seededTorrents: Map<string, TorrentInfo> = new Map();
  private contentDir: string;
  private contentOrigin: string;
  private announce: string[];

  constructor() {
    this.contentDir = path.join(__dirname, '../../content');
    // BEP-19 webseed origin and own trackers (Decision 0008; see
    // docs/architecture/p2p-torrent.md). Both are baked into every magnet,
    // so deployed environments set them explicitly (backend/fly.toml [env])
    // and boot fails without them; only local dev has defaults: the
    // test-content server on :8090 and the tracker from scripts/dev-up.sh.
    this.contentOrigin = envOrDevDefault('CONTENT_ORIGIN_URL', 'http://localhost:8090');
    this.announce = trackerUrls();
  }

  async initialize(): Promise<void> {
    // Dynamic import for ESM module (use Function to avoid TypeScript transpilation)
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const WebTorrent = (await dynamicImport('webtorrent')).default;

    // Create WebTorrent client
    this.client = new WebTorrent() as WebTorrentInstance;

    this.client.on('error', (err: Error | string) => {
      console.error('[Seeder] Client error:', typeof err === 'string' ? err : err.message);
    });

    console.log('[Seeder] WebTorrent client initialized');

    // Seed any existing content
    await this.seedExistingContent();
  }

  private async seedExistingContent(): Promise<void> {
    if (!fs.existsSync(this.contentDir)) {
      console.log('[Seeder] No content directory found, skipping auto-seed');
      return;
    }

    const entries = fs.readdirSync(this.contentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const videoDir = path.join(this.contentDir, entry.name);
        const playlistPath = path.join(videoDir, 'playlist.m3u8');

        if (fs.existsSync(playlistPath)) {
          console.log(`[Seeder] Found video: ${entry.name}`);
          await this.seedDirectory(videoDir, entry.name);
        }
      }
    }
  }

  async seedDirectory(dirPath: string, name: string): Promise<TorrentInfo | null> {
    if (!this.client) {
      throw new Error('Seeder not initialized');
    }

    return new Promise((resolve, reject) => {
      // No `name:` — the torrent name defaults to the directory's basename,
      // which is what fs-chunk-store resolves pieces by. Renaming a seeded
      // path via `name:` makes every piece read fail with ENOENT.
      const options = {
        announce: this.announce,
        // BEP-19 webseed: HTTP fallback for pieces when no P2P peers are
        // available. WebTorrent treats this as another peer — downloaded
        // pieces are re-shared to the swarm.
        // These are directory (multi-file) torrents: WebTorrent appends
        // each file's path, which already starts with the torrent name, so
        // the webseed URL is the *parent* of the video directory. Pointing
        // it at /videos/<name> doubles the name and every request 404s.
        urlList: [`${this.contentOrigin}/videos`],
      };

      // Timeout after 30 seconds; cleared once seeding starts.
      const timer = setTimeout(() => {
        reject(new Error(`Seeding timeout: ${name}`));
      }, 30000);

      this.client!.seed(dirPath, options as any, (torrent) => {
        clearTimeout(timer);
        const info: TorrentInfo = {
          infoHash: torrent.infoHash,
          magnetURI: torrent.magnetURI,
          name: torrent.name,
          files: torrent.files.map((f: any) => f.name)
        };

        this.seededTorrents.set(torrent.infoHash, info);

        console.log(`[Seeder] Seeding: ${torrent.name}`);
        console.log(`[Seeder]   Info Hash: ${torrent.infoHash}`);
        console.log(`[Seeder]   Files: ${torrent.files.length}`);

        // Log stats periodically
        torrent.on('upload', () => {
          if (torrent.uploadSpeed > 0) {
            console.log(`[Seeder] ${torrent.name}: ${torrent.numPeers} peers, ${(torrent.uploadSpeed / 1024).toFixed(2)} KB/s upload`);
          }
        });

        torrent.on('wire', () => {
          console.log(`[Seeder] ${torrent.name}: Peer connected (${torrent.numPeers} total)`);
        });

        resolve(info);
      });

    });
  }

  getSeededTorrents(): TorrentInfo[] {
    return Array.from(this.seededTorrents.values());
  }

  getTorrentByInfoHash(infoHash: string): TorrentInfo | undefined {
    return this.seededTorrents.get(infoHash);
  }

  getStats(): { torrents: number; peers: number; uploadSpeed: number } {
    if (!this.client) {
      return { torrents: 0, peers: 0, uploadSpeed: 0 };
    }

    let totalPeers = 0;
    let totalUploadSpeed = 0;

    for (const torrent of this.client.torrents) {
      totalPeers += torrent.numPeers;
      totalUploadSpeed += torrent.uploadSpeed;
    }

    return {
      torrents: this.client.torrents.length,
      peers: totalPeers,
      uploadSpeed: totalUploadSpeed
    };
  }

  async destroy(): Promise<void> {
    if (this.client) {
      const client = this.client;
      this.client = null;
      return new Promise((resolve) => {
        client.destroy(() => {
          console.log('[Seeder] Client destroyed');
          resolve();
        });
      });
    }
  }
}

// Singleton instance
export const seeder = new SeederService();
