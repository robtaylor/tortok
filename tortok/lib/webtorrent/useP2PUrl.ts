import { useEffect, useState } from 'react';
import { release, requestUrl } from './client';

/**
 * Hook that resolves a torrent to a local bridge URL for video playback.
 *
 * When `torrentFileUrl` is provided, the .torrent file is fetched and passed
 * directly to WebTorrent — resolving in <1s instead of the ~6s magnet
 * round-trip. Falls back to magnet resolution if the fetch fails.
 *
 * Returns `null` while loading or if P2P is disabled/fails.
 *
 * Pass `null` for magnetLink when the component doesn't need a torrent
 * (e.g. off-screen VideoItems) — this is a no-op that skips all work.
 */
export function useP2PUrl(
  magnetLink: string | null,
  torrentFileUrl?: string | null,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!magnetLink) {
      setUrl(null);
      return;
    }

    let cancelled = false;

    requestUrl(magnetLink, torrentFileUrl).then((bridgeUrl) => {
      if (!cancelled) setUrl(bridgeUrl);
    }).catch(() => {
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
