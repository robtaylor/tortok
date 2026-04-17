import type { Torrent } from './types';

/**
 * Register a torrent's files with the bridge server. Lazily starts the server
 * on first call. Returns the bridge URL for the torrent's entry file.
 */
export function registerTorrent(torrent: Torrent): Promise<string>;

/** Remove a torrent's files from the bridge server. */
export function unregisterTorrent(infoHash: string): void;

/** Tear down the bridge server entirely. */
export function destroyBridge(): void;
