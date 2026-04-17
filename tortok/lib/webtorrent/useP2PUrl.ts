import { useEffect, useState } from 'react';
import { release, requestUrl } from './client';

/**
 * Hook that resolves a magnet link to a local bridge URL for video playback.
 *
 * Returns `null` while loading or if P2P is disabled/fails — callers fall
 * back to HLS via `useP2PUrl(magnet) ?? video.hlsURL`.
 *
 * Pass `null` for magnetLink when the component doesn't need a torrent
 * (e.g. off-screen VideoItems) — this is a no-op that skips all work.
 */
export function useP2PUrl(magnetLink: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!magnetLink) {
      setUrl(null);
      return;
    }

    let cancelled = false;

    requestUrl(magnetLink).then((bridgeUrl) => {
      if (!cancelled) setUrl(bridgeUrl);
    }).catch(() => {
      // Silently fall through to HLS
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
