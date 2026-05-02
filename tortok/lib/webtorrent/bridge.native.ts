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
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

// All torrents flowing through the app are single-file MP4s now —
// native fixtures are pre-muxed MP4s, and bridged Bluesky content is
// remuxed from HLS to single-file MP4 at mirror time per ADR-010
// Amendment 2026-05-02 (multi-file webseed via webtorrent.js was
// unreliable on Hermes; single-file pipeline avoids the issue
// entirely). pickEntry stays simple: largest file wins, which for
// a single-file torrent is just the only file.
function pickEntry(files: TorrentFile[]): TorrentFile | undefined {
  return [...files].sort((a, b) => b.length - a.length)[0];
}

// ---------------------------------------------------------------------------
// Torrent registry
// ---------------------------------------------------------------------------

type TorrentEntry = {
  byPath: Map<string, TorrentFile>;
  entry: TorrentFile;
};

// ---------------------------------------------------------------------------
// Server singleton + registry
//
// Stash on globalThis so Metro Fast Refresh doesn't orphan a running server
// when re-executing the module body. The registry MUST also live on globalThis
// because the server handler closure captures it — if only the server is
// preserved across hot reload, new registerTorrent() calls write to the new
// module's Map while the old handler reads the old (empty) Map → 404.
// ---------------------------------------------------------------------------

type BridgeGlobals = {
  __webtorrentBridge?: {
    server: BridgeServer;
    port: number;
    ready: Promise<void>;
    registry: Map<string, TorrentEntry>;
  };
};
const g = globalThis as BridgeGlobals;

/** infoHash → { file map, entry file } */
const registry: Map<string, TorrentEntry> =
  g.__webtorrentBridge?.registry ?? new Map();

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
      // Per-request diagnostics. Lets us tell from logs alone
      // whether AVPlayer is making range requests, the bridge is
      // serving them, and they're completing — vs hanging mid-
      // stream because webtorrent isn't producing piece data.
      let logLine = '';
      let bytesSent = 0;
      let logStartMs = 0;
      let logged = false;
      const finishLog = (suffix: string) => {
        if (logged || !logLine) return;
        logged = true;
        const dt = Date.now() - logStartMs;
        console.log(`[bridge] ${logLine} → ${suffix} (${bytesSent}B in ${dt}ms)`);
      };

      const destroyStream = () => {
        if (readStream) {
          try { readStream.destroy(); } catch { /* ignore */ }
          readStream = null;
        }
        finishLog('closed');
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

        // Begin per-request diagnostic. Truncate the infoHash to
        // 8 chars in the log line so multiple-request streams stay
        // legible — full hash is in the URL above if needed.
        logStartMs = Date.now();
        const rangeRaw = headers.range ?? '';
        logLine = `${method} /${infoHash.slice(0, 8)}…/${filePath}${rangeRaw ? ` range="${rangeRaw}"` : ''}`;

        const torrentEntry = registry.get(infoHash);
        if (!torrentEntry) {
          sock.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          sock.end();
          finishLog('404 (no torrent in registry)');
          return;
        }

        const file =
          torrentEntry.byPath.get(filePath) ??
          (filePath === '' ? torrentEntry.entry : null);
        if (!file) {
          sock.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          sock.end();
          finishLog('404 (file not in torrent)');
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
          finishLog(`${status} (HEAD)`);
          return;
        }

        const stream = file.createReadStream({ start, end: endByte });
        readStream = stream;
        stream.on('data', (buf: unknown) => {
          const b = buf as Buffer;
          bytesSent += b.length;
          sock.write(b);
        });
        stream.on('end', () => {
          sock.end();
          finishLog(status);
        });
        stream.on('error', (err: unknown) => {
          finishLog(`stream error: ${(err as Error)?.message ?? err}`);
          sock.destroy();
        });
      });
    });

    srv.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = srv.address();
      if (!addr) return reject(new Error('bridge: no address after listen'));
      server = srv;
      serverPort = addr.port;
      g.__webtorrentBridge = { server: srv, port: addr.port, ready: serverReady!, registry };
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

  // Encode each path segment individually so internal `/`s stay as
  // path separators in the URL (vs the whole entry.path being one
  // %2F-encoded segment). This matters for multi-file torrents (e.g.
  // bridged HLS, where entry.path is `<cid>/playlist.m3u8`): the
  // player resolves segment URIs relative to the playlist URL, and
  // if the path is encoded as one segment the "directory" for
  // relative resolution is `/<infoHash>/`, so segment requests hit
  // `/<infoHash>/<segName>` and miss byPath (which keys on
  // `<cid>/<segName>`). Per-segment encoding keeps the URL shape
  // `/<infoHash>/<cid>/playlist.m3u8`, so relative resolution lands
  // on `/<infoHash>/<cid>/<segName>` ✓.
  const encodedPath = entry.path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `http://127.0.0.1:${serverPort}/${torrent.infoHash}/${encodedPath}`;
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
