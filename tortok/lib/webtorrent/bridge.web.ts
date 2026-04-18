// Web stub — Service Worker streamer deferred to a later unit.

import type { Torrent } from './types';

export function registerTorrent(_torrent: Torrent): Promise<string> {
  // Reject so `client.ts` catch handler returns null → no playback on web.
  // Service Worker streamer (which would resolve with a real URL) deferred
  // to a later unit.
  return Promise.reject(new Error('bridge: web stub — SW streamer not yet implemented'));
}

export function unregisterTorrent(_infoHash: string): void {}

export function destroyBridge(): void {}
