import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { release, requestUrl } from './client';

/**
 * Extract the first webseed URL (`ws=`) from a magnet link.
 * Returns null if none found.
 */
function extractWebseedUrl(magnetLink: string): string | null {
  const match = magnetLink.match(/[&?]ws=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Hook that resolves a torrent to a playable URL for video playback.
 *
 * On native: resolves via WebTorrent P2P bridge (local HTTP server).
 * On web: extracts the webseed URL from the magnet link and returns it
 * directly — the Service Worker bridge isn't built yet, so we skip the
 * P2P stack entirely and use the HTTP fallback.
 *
 * Returns `null` while loading or if resolution fails.
 *
 * Pass `null` for magnetLink when the component doesn't need a torrent
 * (e.g. off-screen VideoItems) — this is a no-op that skips all work.
 */
export function useP2PUrl(
  magnetLink: string | null,
  torrentFileUrl?: string | null,
  tag?: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!magnetLink) {
      setUrl(null);
      return;
    }

    const label = tag ?? magnetLink.slice(20, 40);

    if (Platform.OS === 'web') {
      const wsUrl = extractWebseedUrl(magnetLink);
      console.log(`[p2p:${label}] web → webseed ${wsUrl ? 'found' : 'missing'}`);
      setUrl(wsUrl);
      return;
    }

    // Native: resolve via WebTorrent bridge.
    let cancelled = false;
    const t0 = Date.now();
    console.log(`[p2p:${label}] requesting…`);

    requestUrl(magnetLink, torrentFileUrl).then((bridgeUrl) => {
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
  }, [magnetLink, torrentFileUrl]);

  return url;
}
