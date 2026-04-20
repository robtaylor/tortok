import { useEffect, useRef } from 'react';
import { requestUrl, release } from './client';
import type { Video } from '@/lib/api';

/** Number of adjacent cells to prefetch in each direction. */
const PREFETCH_WINDOW = 1;

/** Bytes to prefetch per adjacent video (forces WebTorrent to download pieces). */
const PREFETCH_BYTES = 512 * 1024;

type HeldEntry = {
  bridgeUrl: string | null;
  abort: AbortController;
};

/**
 * Prefetch the first chunk of video data for cells adjacent to the active one.
 *
 * This acquires a `requestUrl` hold (bumps refcount) for ±PREFETCH_WINDOW
 * cells, then fetches the first PREFETCH_BYTES from the bridge. The fetch
 * forces WebTorrent to download those pieces into MemoryChunkStore so the
 * bridge can serve them instantly when AVPlayer asks.
 *
 * No player is mounted — this is data-only prefetching.
 */
export function usePrefetch(videos: Video[], activeIndex: number): void {
  const held = useRef(new Map<string, HeldEntry>());

  useEffect(() => {
    const desired = new Map<string, { video: Video; pos: string }>();
    for (let offset = -PREFETCH_WINDOW; offset <= PREFETCH_WINDOW; offset++) {
      if (offset === 0) continue; // active cell manages its own torrent
      const v = videos[activeIndex + offset];
      const pos = offset === 1 ? 'next' : offset === -1 ? 'prev' : `${offset}`;
      if (v?.magnetLink) desired.set(v.magnetLink, { video: v, pos });
    }

    // Release magnets that scrolled out of range
    for (const [magnet, entry] of held.current) {
      if (!desired.has(magnet)) {
        entry.abort.abort();
        release(magnet);
        held.current.delete(magnet);
      }
    }

    // Acquire new magnets and prefetch first bytes
    for (const [magnet, { video, pos }] of desired) {
      if (held.current.has(magnet)) continue;
      const entry: HeldEntry = { bridgeUrl: null, abort: new AbortController() };
      held.current.set(magnet, entry);

      const pre = `[${pos}] [prefetch:${video.caption.slice(0, 20)}]`;
      requestUrl(magnet, video.torrentFileUrl)
        .then((url) => {
          // Guard: magnet may have been released while we awaited
          if (!held.current.has(magnet)) {
            if (url) release(magnet);
            return;
          }
          entry.bridgeUrl = url;
          if (url) {
            const t0 = Date.now();
            console.log(`${pre} fetching ${PREFETCH_BYTES} bytes`);
            fetch(url, {
              headers: { Range: `bytes=0-${PREFETCH_BYTES - 1}` },
              signal: entry.abort.signal,
            })
              .then(() => console.log(`${pre} done in ${Date.now() - t0}ms`))
              .catch(() => {});
          }
        })
        .catch(() => {
          held.current.delete(magnet);
        });
    }
  }, [videos, activeIndex]);

  // Release everything on unmount
  useEffect(() => {
    return () => {
      for (const [, entry] of held.current) {
        entry.abort.abort();
      }
      for (const magnet of held.current.keys()) {
        release(magnet);
      }
      held.current.clear();
    };
  }, []);
}
