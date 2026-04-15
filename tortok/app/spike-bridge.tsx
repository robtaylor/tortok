// Phase 2 Unit 1 — local HTTP bridge spike.
//
// Goal: stand up a tiny HTTP/1.1 server on 127.0.0.1, backed by WebTorrent's
// virtual filesystem, and point an expo-video <VideoView> at it. The bridge
// is the thing that lets native playback (AVPlayer / ExoPlayer) consume
// peer-fetched bytes without going through the file system.
//
// This file is a spike. It will be deleted at the Phase 2 cleanup gate.
//
// TODO(Phase 2 cleanup gate): delete this file, the route registration in
// `_layout.tsx`, and the `isSpikeBridge` branch there. See ADR-006 Phase 2
// and `docs/PHASE_2_PLAN.md` Unit 6.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from 'expo-video';
import TcpSocket from 'react-native-tcp-socket';

// ---------- types (WebTorrent @types are loose; tighten locally) ----------

type Readable = {
  on: (event: 'data' | 'end' | 'error' | 'close', cb: (arg?: unknown) => void) => Readable;
  destroy: () => void;
};

type TorrentFile = {
  name: string;
  path: string;
  length: number;
  createReadStream: (opts?: { start?: number; end?: number }) => Readable;
};

type Torrent = {
  infoHash: string;
  files: TorrentFile[];
  numPeers: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  progress: number;
  on: (event: string, cb: (arg?: unknown) => void) => void;
};

type WebTorrentCtor = new () => {
  add: (magnet: string, cb: (torrent: Torrent) => void) => Torrent;
  destroy: () => void;
  on: (event: string, cb: (arg: unknown) => void) => void;
};

type Server = {
  listen: (opts: { host: string; port: number }, cb?: () => void) => Server;
  address: () => { port: number; address: string } | null;
  close: (cb?: () => void) => void;
};

// Same default as `spike.tsx` — HLS ladder seeded by the dev seeder. Expect
// `playlist.m3u8` + segment `.ts` files at the top level.
const DEFAULT_MAGNET =
  'magnet:?xt=urn:btih:1b8cce932a78923cb57428537829a9e688eed938&dn=tortok-test-video&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.webtorrent.dev';

type Status =
  | 'idle'
  | 'loading polyfills'
  | 'adding'
  | 'discovering'
  | 'starting bridge'
  | 'streaming'
  | 'stopped'
  | 'error';

type Stats = {
  status: Status;
  bridgeUrl: string | null;
  infoHash: string | null;
  peers: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  progress: number;
  firstFrameMs: number | null;
  log: string[];
};

const initialStats: Stats = {
  status: 'idle',
  bridgeUrl: null,
  infoHash: null,
  peers: 0,
  downloaded: 0,
  uploaded: 0,
  downloadSpeed: 0,
  progress: 0,
  firstFrameMs: null,
  log: [],
};

// ---------- HTTP/1.1 bridge ----------
//
// Minimal single-shot server. Each socket handles one request, then closes
// (`Connection: close`). No keep-alive, no pipelining — simpler to reason
// about, and VideoView opens a fresh connection per Range chunk anyway.
//
// Path → file mapping is literal: the URL path (sans leading slash) is
// matched against `torrent.files[].path`. That's what HLS manifests with
// relative URIs produce when VideoView fetches a segment.

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const startS = m[1];
  const endS = m[2];
  // Suffix form `bytes=-N` = last N bytes.
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
  return 'application/octet-stream';
}

function startBridge(
  torrent: Torrent,
  log: (line: string) => void,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    // Pick the "entry" file: prefer playlist.m3u8 if present (HLS), else the
    // largest file (typical for a single-MP4 torrent).
    const entry =
      torrent.files.find((f) => f.name.endsWith('.m3u8')) ??
      [...torrent.files].sort((a, b) => b.length - a.length)[0];
    if (!entry) return reject(new Error('torrent has no files'));
    log(`entry file: ${entry.path} (${entry.length} bytes)`);

    const byPath = new Map<string, TorrentFile>();
    for (const f of torrent.files) byPath.set(f.path, f);

    const server = TcpSocket.createServer((sock) => {
      let head = '';
      let parsed = false;
      let readStream: Readable | null = null;

      const destroyStream = () => {
        if (readStream) {
          try { readStream.destroy(); } catch {}
          readStream = null;
        }
      };

      sock.on('close', destroyStream);
      sock.on('error', (e: unknown) => {
        log(`socket error: ${String(e)}`);
        destroyStream();
      });

      sock.on('data', (chunk: unknown) => {
        if (parsed) return; // all subsequent bytes ignored (one request per socket)
        head += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        // Cap header size — a malformed client could grow `head` unbounded.
        if (head.length > 16 * 1024) {
          log('header too large, closing');
          sock.destroy();
          return;
        }
        const end = head.indexOf('\r\n\r\n');
        if (end < 0) return;
        parsed = true;

        const headerSection = head.slice(0, end);
        const [reqLine, ...lines] = headerSection.split('\r\n');
        const [method, rawUrl] = reqLine.split(' ');
        const headers: Record<string, string> = {};
        for (const line of lines) {
          const i = line.indexOf(':');
          if (i < 0) continue;
          headers[line.slice(0, i).toLowerCase().trim()] = line.slice(i + 1).trim();
        }

        const path = decodeURIComponent((rawUrl ?? '/').replace(/^\//, '').split('?')[0]);
        const file = byPath.get(path) ?? (path === '' ? entry : null);
        if (!file) {
          log(`404: ${path}`);
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
        stream.on('error', (e: unknown) => {
          log(`read error on ${file.path}: ${String(e)}`);
          sock.destroy();
        });
      });
    });

    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = server.address();
      if (!addr) return reject(new Error('no bridge address after listen'));
      const url = `http://127.0.0.1:${addr.port}/${encodeURIComponent(entry.path)}`;
      log(`bridge up on ${addr.port}, entry=${entry.path}`);
      resolve({ server, url });
    });
  });
}

// ---------- screen ----------

export default function SpikeBridgeScreen() {
  const [magnet, setMagnet] = useState(DEFAULT_MAGNET);
  const [stats, setStats] = useState<Stats>(initialStats);
  const clientRef = useRef<InstanceType<WebTorrentCtor> | null>(null);
  const serverRef = useRef<Server | null>(null);
  const startTsRef = useRef<number | null>(null);

  const appendLog = useCallback((line: string) => {
    setStats((s) => ({
      ...s,
      log: [...s.log.slice(-60), `${new Date().toISOString().slice(11, 19)} ${line}`],
    }));
  }, []);

  const teardown = useCallback(() => {
    if (serverRef.current) {
      try { serverRef.current.close(); } catch {}
      serverRef.current = null;
    }
    if (clientRef.current) {
      try { clientRef.current.destroy(); } catch {}
      clientRef.current = null;
    }
  }, []);

  useEffect(() => teardown, [teardown]);

  // VideoView wired to the bridge URL. Player stays null until we have one.
  const player = useVideoPlayer(stats.bridgeUrl, (p) => {
    p.loop = true;
    p.muted = true; // autoplay requires muted on most platforms
  });

  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (payload: { status: VideoPlayerStatus }) => {
      appendLog(`player.status=${payload.status}`);
      if (payload.status === 'readyToPlay' && stats.firstFrameMs === null && startTsRef.current) {
        const ms = Date.now() - startTsRef.current;
        setStats((s) => ({ ...s, firstFrameMs: ms }));
        appendLog(`firstFrame: ${ms}ms`);
      }
    });
    return () => sub.remove();
  }, [player, appendLog, stats.firstFrameMs]);

  const handleStart = async () => {
    if (clientRef.current) {
      appendLog('already running — stop first');
      return;
    }
    setStats({ ...initialStats, status: 'loading polyfills' });
    startTsRef.current = Date.now();

    let WebTorrent: WebTorrentCtor;
    try {
      await import('@/lib/webtorrent/polyfills');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('webtorrent');
      WebTorrent = (mod?.default ?? mod) as WebTorrentCtor;
      appendLog('webtorrent loaded');
    } catch (err) {
      appendLog(`load failed: ${String(err)}`);
      setStats((s) => ({ ...s, status: 'error' }));
      return;
    }

    const client = new WebTorrent();
    clientRef.current = client;
    client.on('error', (e: unknown) => appendLog(`client error: ${String(e)}`));

    appendLog('adding magnet');
    setStats((s) => ({ ...s, status: 'adding' }));
    const pending = client.add(magnet, async (torrent: Torrent) => {
      appendLog(`metadata: ${torrent.infoHash} (${torrent.files.length} files)`);
      setStats((s) => ({ ...s, status: 'starting bridge', infoHash: torrent.infoHash }));

      try {
        const { server, url } = await startBridge(torrent, appendLog);
        serverRef.current = server;
        setStats((s) => ({ ...s, status: 'streaming', bridgeUrl: url }));
      } catch (err) {
        appendLog(`bridge failed: ${String(err)}`);
        setStats((s) => ({ ...s, status: 'error' }));
        return;
      }

      // WebTorrent fires 'download' per-chunk (100s/sec during active
      // streaming). Unconditional setStats would flood React with re-renders
      // and skew first-frame timing. Throttle to 4 Hz — still smooth for a
      // dev HUD, noise-free for measurement.
      let lastUpdate = 0;
      torrent.on('download', () => {
        const now = Date.now();
        if (now - lastUpdate < 250) return;
        lastUpdate = now;
        setStats((s) => ({
          ...s,
          peers: torrent.numPeers,
          downloaded: torrent.downloaded,
          uploaded: torrent.uploaded,
          downloadSpeed: torrent.downloadSpeed,
          progress: torrent.progress,
        }));
      });
    });

    pending.on('infoHash', () => setStats((s) => ({ ...s, status: 'discovering', infoHash: pending.infoHash })));
    pending.on('wire', () => appendLog(`wire (peers=${pending.numPeers})`));
    pending.on('warning', (w: unknown) => appendLog(`warning: ${String(w)}`));
    pending.on('error', (e: unknown) => appendLog(`torrent error: ${String(e)}`));
  };

  const handleStop = () => {
    appendLog('stop');
    teardown();
    setStats((s) => ({ ...s, status: 'stopped', bridgeUrl: null }));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>WebTorrent bridge spike</Text>
      <Text style={styles.subtitle}>Phase 2 Unit 1 — does the HTTP bridge serve bytes to VideoView?</Text>

      {stats.bridgeUrl ? (
        <View style={styles.videoBox}>
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls
          />
        </View>
      ) : (
        <View style={[styles.videoBox, styles.videoPlaceholder]}>
          <Text style={styles.placeholderText}>video will appear once the bridge is up</Text>
        </View>
      )}

      <Text style={styles.label}>Magnet URI</Text>
      <TextInput
        style={styles.input}
        value={magnet}
        onChangeText={setMagnet}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />

      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.primary]} onPress={handleStart} testID="bridgeStart">
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={handleStop} testID="bridgeStop">
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
      </View>

      <View style={styles.stats}>
        <Stat label="Status" value={stats.status} />
        <Stat label="Bridge" value={stats.bridgeUrl ?? '—'} />
        <Stat label="Info hash" value={stats.infoHash ?? '—'} />
        <Stat label="Peers" value={String(stats.peers)} />
        <Stat label="Down" value={formatBytes(stats.downloaded)} />
        <Stat label="Up" value={formatBytes(stats.uploaded)} />
        <Stat label="Speed" value={`${formatBytes(stats.downloadSpeed)}/s`} />
        <Stat label="Progress" value={`${(stats.progress * 100).toFixed(1)}%`} />
        <Stat label="First frame" value={stats.firstFrameMs != null ? `${stats.firstFrameMs} ms` : '—'} />
      </View>

      <Text style={styles.label}>Log</Text>
      <View style={styles.log}>
        {stats.log.map((line, i) => (
          <Text key={i} style={styles.logLine}>{line}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingTop: 60 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  subtitle: { color: '#888', fontSize: 13, marginBottom: 16 },
  videoBox: { height: 220, backgroundColor: '#111', borderRadius: 6, marginBottom: 12, overflow: 'hidden' },
  videoPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#666', fontSize: 13 },
  video: { flex: 1 },
  label: { color: '#888', fontSize: 12, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#111',
    color: '#fff',
    fontSize: 11,
    padding: 10,
    borderRadius: 6,
    minHeight: 70,
    fontFamily: 'Courier',
  },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: 'center' },
  primary: { backgroundColor: '#2e78b7' },
  secondary: { backgroundColor: '#444' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  stats: { marginTop: 16, backgroundColor: '#111', borderRadius: 6, padding: 12 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  statLabel: { color: '#888', fontSize: 13 },
  statValue: { color: '#fff', fontSize: 13, fontFamily: 'Courier', flexShrink: 1, textAlign: 'right' },
  log: { backgroundColor: '#111', borderRadius: 6, padding: 10, marginBottom: 40 },
  logLine: { color: '#aaa', fontSize: 11, fontFamily: 'Courier', lineHeight: 16 },
});
