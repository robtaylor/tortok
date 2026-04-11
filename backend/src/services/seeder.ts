import path from 'path';
import fs from 'fs';

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

  constructor() {
    this.contentDir = path.join(__dirname, '../../content');
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
      const options = {
        name,
        announce: [
          'wss://tracker.openwebtorrent.com',
          'wss://tracker.btorrent.xyz',
          'wss://tracker.webtorrent.dev'
        ]
      };

      this.client!.seed(dirPath, options as any, (torrent) => {
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

      // Timeout after 30 seconds
      setTimeout(() => {
        reject(new Error('Seeding timeout'));
      }, 30000);
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
      return new Promise((resolve) => {
        this.client!.destroy(() => {
          console.log('[Seeder] Client destroyed');
          resolve();
        });
      });
    }
  }
}

// Singleton instance
export const seeder = new SeederService();
