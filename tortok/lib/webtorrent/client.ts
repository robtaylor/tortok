// Singleton WebTorrent client with refcounted torrent management.
//
// Gated on EXPO_PUBLIC_USE_P2P — set to '0' to disable. Enabled by default.
// When disabled, all exports are no-ops and no WebTorrent code is loaded.

import type { ChunkStoreCtor, Torrent, WebTorrentClient, WebTorrentCtor } from './types';
import { destroyBridge, registerTorrent, unregisterTorrent } from './bridge';

const P2P_ENABLED = process.env.EXPO_PUBLIC_USE_P2P !== '0';

/** Grace period before removing an unreferenced torrent (prevents scroll thrashing). */
const RELEASE_GRACE_MS = 5_000;

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let client: WebTorrentClient | null = null;
let MemoryChunkStore: ChunkStoreCtor | null = null;
let initPromise: Promise<boolean> | null = null;

/** One-shot init: polyfills → WebTorrent + chunk store. Returns false on failure. */
function ensureClient(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await import('@/lib/webtorrent/polyfills');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const wtMod = require('webtorrent');
      const WT = (wtMod?.default ?? wtMod) as WebTorrentCtor;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const storeMod = require('memory-chunk-store');
      MemoryChunkStore = (storeMod?.default ?? storeMod) as ChunkStoreCtor;

      client = new WT();
      client.on('error', (e: unknown) => {
        console.warn('[webtorrent] client error:', e);
      });
      return true;
    } catch (e) {
      console.warn('[webtorrent] init failed:', e);
      return false;
    }
  })();

  return initPromise;
}

// ---------------------------------------------------------------------------
// Torrent refcount map
// ---------------------------------------------------------------------------

type ManagedTorrent = {
  torrent: Torrent;
  bridgeUrl: string;
  refCount: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
};

/** Keyed by magnet link. */
const managed = new Map<string, ManagedTorrent>();

/** In-flight requestUrl promises — prevents duplicate `client.add()` when two
 *  VideoItems (active + adjacent) mount simultaneously for the same magnet. */
const pending = new Map<string, Promise<string | null>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Request a bridge URL for a torrent. Bumps refcount if the torrent is
 * already active; otherwise adds it to the client and registers it with the
 * bridge. Returns `null` if P2P is disabled or any step fails.
 *
 * When `torrentFileUrl` is provided, the .torrent file is fetched and passed
 * directly to `client.add(buffer)` — this skips the ~6s magnet resolution
 * round-trip (no tracker/peer needed for metadata). Falls back to magnet
 * resolution if the fetch fails.
 */
export async function requestUrl(
  magnetLink: string,
  torrentFileUrl?: string | null,
): Promise<string | null> {
  if (!P2P_ENABLED) return null;

  // Fast path: torrent already managed
  const existing = managed.get(magnetLink);
  if (existing) {
    existing.refCount++;
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
    }
    return existing.bridgeUrl;
  }

  // Dedup: if another caller is already adding this magnet, piggyback on it
  const inflight = pending.get(magnetLink);
  if (inflight) {
    const url = await inflight;
    // Bump refcount for this additional consumer
    const entry = managed.get(magnetLink);
    if (entry) {
      entry.refCount++;
      if (entry.graceTimer) {
        clearTimeout(entry.graceTimer);
        entry.graceTimer = null;
      }
    }
    return url;
  }

  const p = doAdd(magnetLink, torrentFileUrl);
  pending.set(magnetLink, p);
  p.finally(() => pending.delete(magnetLink));
  return p;
}

/** Fetch a .torrent file and return it as a Uint8Array, or null on failure. */
async function fetchTorrentFile(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[webtorrent] .torrent fetch failed:', url, res.status);
      return null;
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    console.warn('[webtorrent] .torrent fetch failed:', url);
    return null;
  }
}

async function doAdd(
  magnetLink: string,
  torrentFileUrl?: string | null,
): Promise<string | null> {
  const ok = await ensureClient();
  if (!ok || !client || !MemoryChunkStore) return null;

  // Prefer .torrent buffer (instant resolution) over magnet (6s round-trip)
  let torrentId: string | Uint8Array = magnetLink;
  if (torrentFileUrl) {
    const buf = await fetchTorrentFile(torrentFileUrl);
    if (buf) torrentId = buf;
  }

  try {
    const torrent = await new Promise<Torrent>((resolve, reject) => {
      const t = client!.add(torrentId, { store: MemoryChunkStore! }, (torrent: Torrent) => {
        resolve(torrent);
      });
      t.on('error', (e: unknown) => reject(e));
    });

    // Wait for the first piece before handing the URL to the video player.
    // Without this, the bridge serves an empty stream and the player errors.
    if (torrent.progress === 0) {
      await new Promise<void>((resolve, reject) => {
        const onDownload = () => { cleanup(); resolve(); };
        const onError = (e: unknown) => { cleanup(); reject(e); };
        const timeout = setTimeout(() => { cleanup(); resolve(); }, 15_000);
        function cleanup() {
          torrent.removeListener('download', onDownload);
          torrent.removeListener('error', onError);
          clearTimeout(timeout);
        }
        torrent.on('download', onDownload);
        torrent.on('error', onError);
      });
    }

    // Log P2P offload ratio once download completes.
    const logOffload = () => {
      const wsBytes = torrent.wires
        .filter((w) => w.type === 'webSeed')
        .reduce((sum, w) => sum + w.downloaded, 0);
      const p2pBytes = torrent.wires
        .filter((w) => w.type !== 'webSeed')
        .reduce((sum, w) => sum + w.downloaded, 0);
      const total = wsBytes + p2pBytes;
      const p2pPct = total > 0 ? Math.round((p2pBytes / total) * 100) : 0;
      console.log(
        `[webtorrent] offload: ${p2pPct}% P2P (${p2pBytes}B) / ${100 - p2pPct}% webseed (${wsBytes}B) | ${torrent.numPeers} peers`,
      );
    };
    if (torrent.progress === 1) {
      logOffload();
    } else {
      torrent.on('done', logOffload);
    }

    const bridgeUrl = await registerTorrent(torrent);

    managed.set(magnetLink, {
      torrent,
      bridgeUrl,
      refCount: 1,
      graceTimer: null,
    });

    return bridgeUrl;
  } catch (e) {
    console.warn('[webtorrent] requestUrl failed:', e);
    return null;
  }
}

/**
 * Release a reference to a magnet link. When refcount hits 0, a grace timer
 * starts — if not re-requested within RELEASE_GRACE_MS, the torrent is
 * removed from the client and unregistered from the bridge.
 */
export function release(magnetLink: string): void {
  const entry = managed.get(magnetLink);
  if (!entry) return;

  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;

  // Clear any existing grace timer to prevent leaked timers from double-release
  if (entry.graceTimer) {
    clearTimeout(entry.graceTimer);
  }
  entry.graceTimer = setTimeout(() => {
    // Re-check: might have been re-requested during the grace period
    if (entry.refCount > 0) return;

    unregisterTorrent(entry.torrent.infoHash);
    managed.delete(magnetLink);

    if (client) {
      // destroyStore: true ensures memory-chunk-store releases its piece buffers
      client.remove(entry.torrent, { destroyStore: true }, (err?: Error) => {
        if (err) console.warn('[webtorrent] remove error:', err);
      });
    }
  }, RELEASE_GRACE_MS);
}

/** Tear down everything: all torrents, bridge server, WebTorrent client. */
export function destroyClient(): void {
  for (const [magnet, entry] of managed) {
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    managed.delete(magnet);
  }
  destroyBridge();
  if (client) {
    client.destroy();
    client = null;
    initPromise = null;
  }
}
