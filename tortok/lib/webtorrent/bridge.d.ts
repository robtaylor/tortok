import type { Torrent } from './types';

/**
 * Register a torrent's files with the bridge server. Lazily starts the server
 * on first call. Returns the bridge URL for the torrent's entry file.
 */
export function registerTorrent(torrent: Torrent): Promise<string>;

/** Remove a torrent's files from the bridge server. */
export function unregisterTorrent(infoHash: string): void;

/**
 * Read and discard the first `bytes` of the file a bridge URL names, so
 * WebTorrent downloads them. Resolves with the bytes read.
 */
export function readAhead(bridgeUrl: string, bytes: number, signal: AbortSignal): Promise<number>;

/** Tear down the bridge server entirely. */
export function destroyBridge(): void;
