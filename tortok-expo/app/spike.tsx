// Phase 2 WebTorrent spike — see ADR-009 for scope.
//
// This route is intentionally not linked from any tab or nav; reach it by
// typing `tortokexpo://spike` in the Expo dev client, or by navigating
// directly during development. Pass/fail bar: the stats panel below has to
// show `Downloaded > 0` and at least one peer from a second client running
// on a different simulator or on Expo web.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable, ScrollView } from 'react-native';

// WebTorrent and polyfills are loaded lazily from within Start handler so
// the Expo static renderer (which runs in Node) never imports them. The
// polyfill module installs globals as a side effect; WebTorrent then
// module-inits after the globals exist.
type WebTorrentCtor = new () => {
  add: (magnet: string, cb: (torrent: Torrent) => void) => void;
  destroy: () => void;
  on: (event: string, cb: (arg: unknown) => void) => void;
};
type Torrent = {
  infoHash: string;
  numPeers: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  progress: number;
  on: (event: string, cb: () => void) => void;
};

const DEFAULT_MAGNET =
  'magnet:?xt=urn:btih:1b8cce932a78923cb57428537829a9e688eed938&dn=tortok-test-video&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.webtorrent.dev';

type Stats = {
  status: string;
  infoHash: string | null;
  peers: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  progress: number;
  log: string[];
};

const initialStats: Stats = {
  status: 'idle',
  infoHash: null,
  peers: 0,
  downloaded: 0,
  uploaded: 0,
  downloadSpeed: 0,
  progress: 0,
  log: [],
};

export default function SpikeScreen() {
  const [magnet, setMagnet] = useState(DEFAULT_MAGNET);
  const [stats, setStats] = useState<Stats>(initialStats);
  const clientRef = useRef<InstanceType<WebTorrentCtor> | null>(null);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = null;
      }
    };
  }, []);

  const appendLog = (line: string) => {
    setStats((s) => ({ ...s, log: [...s.log.slice(-40), `${new Date().toISOString().slice(11, 19)} ${line}`] }));
  };

  const handleStart = async () => {
    if (clientRef.current) {
      appendLog('already running — destroy first');
      return;
    }
    setStats({ ...initialStats, status: 'loading polyfills' });
    appendLog('loading polyfills + webtorrent');

    let WebTorrent: WebTorrentCtor;
    try {
      // Side-effect import installs Buffer/process/RTCPeerConnection globals.
      await import('@/lib/webtorrent/polyfills');
      // Dynamic require so the Expo static renderer never touches WebTorrent.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      WebTorrent = require('webtorrent') as WebTorrentCtor;
    } catch (err) {
      appendLog(`load threw: ${String(err)}`);
      setStats((s) => ({ ...s, status: 'error' }));
      return;
    }

    setStats((s) => ({ ...s, status: 'creating client' }));
    appendLog('new WebTorrent()');
    let client: InstanceType<WebTorrentCtor>;
    try {
      client = new WebTorrent();
    } catch (err) {
      appendLog(`client ctor threw: ${String(err)}`);
      setStats((s) => ({ ...s, status: 'error' }));
      return;
    }
    clientRef.current = client;

    client.on('error', (err: unknown) => {
      appendLog(`client error: ${String(err)}`);
    });

    appendLog('adding magnet');
    setStats((s) => ({ ...s, status: 'adding' }));

    client.add(magnet, (torrent: Torrent) => {
      appendLog(`torrent added: ${torrent.infoHash}`);
      setStats((s) => ({ ...s, status: 'connecting', infoHash: torrent.infoHash }));

      torrent.on('wire', () => appendLog('wire (new peer connected)'));
      torrent.on('download', () => {
        setStats((s) => ({
          ...s,
          status: 'downloading',
          peers: torrent.numPeers,
          downloaded: torrent.downloaded,
          uploaded: torrent.uploaded,
          downloadSpeed: torrent.downloadSpeed,
          progress: torrent.progress,
        }));
      });
      torrent.on('done', () => {
        appendLog('done');
        setStats((s) => ({ ...s, status: 'done', progress: 1 }));
      });
    });
  };

  const handleStop = () => {
    if (!clientRef.current) return;
    appendLog('destroying client');
    clientRef.current.destroy();
    clientRef.current = null;
    setStats((s) => ({ ...s, status: 'destroyed' }));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>WebTorrent spike</Text>
      <Text style={styles.subtitle}>Phase 2 — does WebTorrent run on Hermes?</Text>

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
        <Pressable style={[styles.button, styles.primary]} onPress={handleStart} testID="spikeStart">
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={handleStop} testID="spikeStop">
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
      </View>

      <View style={styles.stats}>
        <Stat label="Status" value={stats.status} />
        <Stat label="Info hash" value={stats.infoHash ?? '—'} />
        <Stat label="Peers" value={String(stats.peers)} />
        <Stat label="Downloaded" value={formatBytes(stats.downloaded)} />
        <Stat label="Uploaded" value={formatBytes(stats.uploaded)} />
        <Stat label="Speed" value={`${formatBytes(stats.downloadSpeed)}/s`} />
        <Stat label="Progress" value={`${(stats.progress * 100).toFixed(1)}%`} />
      </View>

      <Text style={styles.label}>Log</Text>
      <View style={styles.log}>
        {stats.log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
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
  subtitle: { color: '#888', fontSize: 13, marginBottom: 20 },
  label: { color: '#888', fontSize: 12, marginTop: 16, marginBottom: 4 },
  input: {
    backgroundColor: '#111',
    color: '#fff',
    fontSize: 11,
    padding: 10,
    borderRadius: 6,
    minHeight: 80,
    fontFamily: 'Courier',
  },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: 'center' },
  primary: { backgroundColor: '#2e78b7' },
  secondary: { backgroundColor: '#444' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  stats: { marginTop: 20, backgroundColor: '#111', borderRadius: 6, padding: 12 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  statLabel: { color: '#888', fontSize: 13 },
  statValue: { color: '#fff', fontSize: 13, fontFamily: 'Courier' },
  log: { backgroundColor: '#111', borderRadius: 6, padding: 10, marginBottom: 40 },
  logLine: { color: '#aaa', fontSize: 11, fontFamily: 'Courier', lineHeight: 16 },
});
