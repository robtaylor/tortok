// The URL a feed item plays, for whichever kind of playback it has: a native
// post's torrent through WebTorrent (useP2PUrl), a bridged Bluesky post's HLS
// playlist as it is (Decision 0010: plain HTTP, no P2P). Only the active item
// resolves one; others get null.

import type { Video } from '@/lib/api';
import { useP2PUrl } from '@/lib/webtorrent/useP2PUrl';

export function usePlaybackUrl(video: Video, isActive: boolean, tag?: string): string | null {
  const { playback } = video;
  // Hooks run unconditionally: useP2PUrl idles when given null.
  const p2pUrl = useP2PUrl(isActive && playback.kind === 'torrent' ? playback : null, tag);
  if (!isActive) return null;
  switch (playback.kind) {
    case 'torrent':
      return p2pUrl;
    case 'hls':
      return playback.url;
    default: {
      const unhandled: never = playback;
      throw new Error(`unhandled playback kind ${(unhandled as { kind: string }).kind}`);
    }
  }
}
