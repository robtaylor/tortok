import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { release, requestUrl } from './client';
import type { TorrentPlayback } from '@/lib/api';

/**
 * The first webseed to play from on web: the magnet's own (`ws=`), else one
 * the AppView listed. Null if there's none.
 */
function firstWebseed(playback: TorrentPlayback): string | null {
  const match = playback.magnetLink.match(/[&?]ws=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : (playback.sources.webseeds[0] ?? null);
}

/**
 * Hook that resolves a torrent to a playable URL for video playback.
 *
 * On native: resolves via WebTorrent P2P bridge (local HTTP server).
 * On web: plays a webseed directly over HTTP — the Service Worker bridge
 * isn't built yet, so we skip the P2P stack entirely.
 *
 * Returns `null` while loading or if resolution fails.
 *
 * Pass `null` when the component doesn't need a torrent (e.g. off-screen
 * VideoItems) — this is a no-op that skips all work. The torrent is keyed by
 * its magnet link, so a refetched feed item with the same magnet doesn't
 * restart playback.
 */
export function useP2PUrl(playback: TorrentPlayback | null, tag?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const latest = useRef(playback);
  latest.current = playback;
  const magnetLink = playback?.magnetLink ?? null;

  useEffect(() => {
    const current = latest.current;
    if (!magnetLink || !current) {
      setUrl(null);
      return;
    }

    const label = tag ?? magnetLink.slice(20, 40);

    if (Platform.OS === 'web') {
      const wsUrl = firstWebseed(current);
      console.log(`[p2p:${label}] web → webseed ${wsUrl ? 'found' : 'missing'}`);
      setUrl(wsUrl);
      return;
    }

    // Native: resolve via WebTorrent bridge.
    let cancelled = false;
    const t0 = Date.now();
    console.log(`[p2p:${label}] requesting…`);

    requestUrl(current).then((bridgeUrl) => {
      console.log(`[p2p:${label}] resolved in ${Date.now() - t0}ms → ${bridgeUrl ? 'url' : 'null'}`);
      if (!cancelled) setUrl(bridgeUrl);
    }).catch((e: Error) => {
      console.warn(`[p2p:${label}] error after ${Date.now() - t0}ms:`, e.message);
      if (!cancelled) setUrl(null);
    });

    return () => {
      cancelled = true;
      release(magnetLink);
      setUrl(null);
    };
  }, [magnetLink]);

  return url;
}
