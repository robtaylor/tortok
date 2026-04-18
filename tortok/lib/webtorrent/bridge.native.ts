// Native HTTP bridge — serves torrent file bytes to expo-video via TcpSocket.
//
// One server instance shared across the entire app, lazily started on first
// `registerTorrent()` call. URL scheme:
//
//   http://127.0.0.1:<port>/<infoHash>/<filePath>
//
// The infoHash prefix routes to the correct torrent; the remainder resolves
// a file within that torrent. Root path (`/<infoHash>` or `/<infoHash>/`)
// resolves to the entry file (prefer .m3u8, else largest).

import TcpSocket from 'react-native-tcp-socket';
import type { BridgeServer, Readable, Torrent, TorrentFile } from './types';

// ---------------------------------------------------------------------------
// Helpers (extracted from spike-bridge.tsx)
// ---------------------------------------------------------------------------

function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const startS = m[1];
  const endS = m[2];
  if (startS === '' && endS !== '') {
    const n = parseInt(endS, 10);
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = startS ? parseInt(startS, 10) : 0;
  const end = endS ? parseInt(endS, 10) : size - 1;
  if (isNaN(start) || isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (name.endsWith('.ts')) return 'video/mp2t';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

/** Pick the best "entry" file: prefer .m3u8 playlist, else largest file. */
function pickEntry(files: TorrentFile[]): TorrentFile | undefined {
  return (
    files.find((f) => f.name.endsWith('.m3u8')) ??
    [...files].sort((a, b) => b.length - a.length)[0]
  );
}

// ---------------------------------------------------------------------------
// Torrent registry
// ---------------------------------------------------------------------------

type TorrentEntry = {
  byPath: Map<string, TorrentFile>;
  entry: TorrentFile;
};

/** infoHash → { file map, entry file } */
const registry = new Map<string, TorrentEntry>();

// ---------------------------------------------------------------------------
// Server singleton
//
// Stash on globalThis so Metro Fast Refresh doesn't orphan a running server
// when re-executing the module body. The old module's references are lost but
// the server keeps listening — without this guard we'd start a second server
// on a new port and leak the first.
// ---------------------------------------------------------------------------

type BridgeGlobals = {
  __webtorrentBridge?: { server: BridgeServer; port: number; ready: Promise<void> };
};
const g = globalThis as BridgeGlobals;

let server: BridgeServer | null = g.__webtorrentBridge?.server ?? null;
let serverPort: number | null = g.__webtorrentBridge?.port ?? null;
let serverReady: Promise<void> | null = g.__webtorrentBridge?.ready ?? null;

function ensureServer(): Promise<void> {
  if (serverReady) return serverReady;

  serverReady = new Promise<void>((resolve, reject) => {
    const srv = TcpSocket.createServer((sock) => {
      let head = '';
      let parsed = false;
      let readStream: Readable | null = null;

      const destroyStream = () => {
        if (readStream) {
          try { readStream.destroy(); } catch { /* ignore */ }
          readStream = null;
        }
      };

      sock.on('close', destroyStream);
      sock.on('error', destroyStream);

      sock.on('data', (chunk: unknown) => {
        if (parsed) return;
        head += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        if (head.length > 16 * 1024) {
          sock.destroy();
          return;
        }
        const endIdx = head.indexOf('\r\n\r\n');
        if (endIdx < 0) return;
        parsed = true;

        const headerSection = head.slice(0, endIdx);
        const [reqLine, ...lines] = headerSection.split('\r\n');
        const [method, rawUrl] = reqLine.split(' ');
        const headers: Record<string, string> = {};
        for (const line of lines) {
          const i = line.indexOf(':');
          if (i < 0) continue;
          headers[line.slice(0, i).toLowerCase().trim()] = line.slice(i + 1).trim();
        }

        // URL: /<infoHash>/<filePath>
        const urlPath = decodeURIComponent((rawUrl ?? '/').split('?')[0]);
        const segments = urlPath.replace(/^\//, '').split('/');
        const infoHash = segments[0] ?? '';
        const filePath = segments.slice(1).join('/');

        const torrentEntry = registry.get(infoHash);
        if (!torrentEntry) {
          sock.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          sock.end();
          return;
        }

        const file =
          torrentEntry.byPath.get(filePath) ??
          (filePath === '' ? torrentEntry.entry : null);
        if (!file) {
          sock.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          sock.end();
          return;
        }

        const range = parseRange(headers.range, file.length);
        const start = range?.start ?? 0;
        const endByte = range?.end ?? file.length - 1;
        const len = endByte - start + 1;
        const status = range ? '206 Partial Content' : '200 OK';

        const resHead =
          `HTTP/1.1 ${status}\r\n` +
          `Content-Type: ${contentTypeFor(file.name)}\r\n` +
          `Accept-Ranges: bytes\r\n` +
          `Content-Length: ${len}\r\n` +
          (range ? `Content-Range: bytes ${start}-${endByte}/${file.length}\r\n` : '') +
          'Connection: close\r\n' +
          '\r\n';
        sock.write(resHead);

        if (method === 'HEAD') {
          sock.end();
          return;
        }

        const stream = file.createReadStream({ start, end: endByte });
        readStream = stream;
        stream.on('data', (buf: unknown) => {
          sock.write(buf as Buffer);
        });
        stream.on('end', () => {
          sock.end();
        });
        stream.on('error', () => {
          sock.destroy();
        });
      });
    });

    srv.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = srv.address();
      if (!addr) return reject(new Error('bridge: no address after listen'));
      server = srv;
      serverPort = addr.port;
      g.__webtorrentBridge = { server: srv, port: addr.port, ready: serverReady! };
      resolve();
    });
  });

  return serverReady;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function registerTorrent(torrent: Torrent): Promise<string> {
  await ensureServer();

  const byPath = new Map<string, TorrentFile>();
  for (const f of torrent.files) byPath.set(f.path, f);

  const entry = pickEntry(torrent.files);
  if (!entry) throw new Error(`torrent ${torrent.infoHash} has no files`);

  registry.set(torrent.infoHash, { byPath, entry });

  return `http://127.0.0.1:${serverPort}/${torrent.infoHash}/${encodeURIComponent(entry.path)}`;
}

export function unregisterTorrent(infoHash: string): void {
  registry.delete(infoHash);
}

export function destroyBridge(): void {
  registry.clear();
  if (server) {
    server.close();
    server = null;
    serverPort = null;
    serverReady = null;
    delete g.__webtorrentBridge;
  }
}
