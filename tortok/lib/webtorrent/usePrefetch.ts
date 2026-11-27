import { useEffect, useRef } from 'react';
import { readAhead } from './bridge';
import { requestUrl, release } from './client';
import { torrentOf, type TorrentPlayback, type Video } from '@/lib/api';

/** Number of adjacent cells to prefetch in each direction. */
const PREFETCH_WINDOW = 1;

/** Bytes to prefetch per adjacent video (forces WebTorrent to download pieces). */
const PREFETCH_BYTES = 512 * 1024;

/**
 * Prefetch the first chunk of video data for cells adjacent to the active one.
 *
 * This acquires a `requestUrl` hold (bumps refcount) for ±PREFETCH_WINDOW
 * cells, then reads the first PREFETCH_BYTES of the file (bridge.readAhead).
 * The read forces WebTorrent to download those pieces into MemoryChunkStore
 * so the bridge can serve them instantly when the player asks.
 *
 * No player is mounted — this is data-only prefetching.
 */
export function usePrefetch(videos: Video[], activeIndex: number): void {
  /** The magnets held, each with what aborts its read-ahead. */
  const held = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const desired = new Map<string, { video: Video; torrent: TorrentPlayback; pos: string }>();
    for (let offset = -PREFETCH_WINDOW; offset <= PREFETCH_WINDOW; offset++) {
      if (offset === 0) continue; // active cell manages its own torrent
      const v = videos[activeIndex + offset];
      const pos = offset === 1 ? 'next' : offset === -1 ? 'prev' : `${offset}`;
      const torrent = v && torrentOf(v);
      if (torrent) desired.set(torrent.magnetLink, { video: v, torrent, pos });
    }

    // Release magnets that scrolled out of range
    for (const [magnet, abort] of held.current) {
      if (!desired.has(magnet)) {
        abort.abort();
        release(magnet);
        held.current.delete(magnet);
      }
    }

    // Acquire new magnets and prefetch first bytes
    for (const [magnet, { video, torrent, pos }] of desired) {
      if (held.current.has(magnet)) continue;
      const abort = new AbortController();
      held.current.set(magnet, abort);

      const pre = `[${pos}] [prefetch:${video.caption.slice(0, 20)}]`;
      requestUrl(torrent)
        .then((url) => {
          // While the URL was awaited this hold may have been released, and
          // the magnet even taken up again by a later one: give back what
          // this request took.
          if (held.current.get(magnet) !== abort) {
            if (url) release(magnet);
            return;
          }
          if (!url) return;
          const t0 = Date.now();
          console.log(`${pre} reading ${PREFETCH_BYTES} bytes ahead`);
          readAhead(url, PREFETCH_BYTES, abort.signal)
            .then((read) => console.log(`${pre} read ${read} bytes in ${Date.now() - t0}ms`))
            .catch((e: Error) => {
              // Scrolling away aborts it, which is no failure.
              if (!abort.signal.aborted) console.warn(`${pre} read-ahead failed: ${e.message}`);
            });
        })
        .catch(() => {
          if (held.current.get(magnet) === abort) held.current.delete(magnet);
        });
    }
  }, [videos, activeIndex]);

  // Release everything on unmount
  useEffect(() => {
    return () => {
      for (const [magnet, abort] of held.current) {
        abort.abort();
        release(magnet);
      }
      held.current.clear();
    };
  }, []);
}
