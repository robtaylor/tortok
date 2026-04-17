// Shared types for the WebTorrent P2P layer.
//
// WebTorrent's own @types are loose and assume a browser or Node environment.
// We tighten them here to the subset we actually use, which keeps TypeScript
// happy on Hermes (no DOM, no full Node) and documents the contract between
// the client, bridge, and hook.

export type Readable = {
  on: (event: 'data' | 'end' | 'error' | 'close', cb: (arg?: unknown) => void) => Readable;
  destroy: () => void;
};

export type TorrentFile = {
  name: string;
  path: string;
  length: number;
  createReadStream: (opts?: { start?: number; end?: number }) => Readable;
};

export type Torrent = {
  infoHash: string;
  magnetURI: string;
  files: TorrentFile[];
  numPeers: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  progress: number;
  pieces: Array<unknown | null>;
  on: (event: string, cb: (arg?: unknown) => void) => void;
};

/** chunk-store constructor — MemoryChunkStore / FSAChunkStore / future RNFS store */
export type ChunkStoreCtor = new (chunkLength: number, opts?: unknown) => unknown;

export type AddOpts = { store?: ChunkStoreCtor };

export type WebTorrentClient = {
  add: (
    magnet: string,
    optsOrCb: AddOpts | ((torrent: Torrent) => void),
    cb?: (torrent: Torrent) => void,
  ) => Torrent;
  remove: (
    torrentOrId: Torrent | string,
    opts?: { destroyStore?: boolean },
    cb?: (err?: Error) => void,
  ) => void;
  destroy: (cb?: (err?: Error) => void) => void;
  on: (event: string, cb: (arg: unknown) => void) => void;
};

export type WebTorrentCtor = new () => WebTorrentClient;

export type BridgeServer = {
  listen: (opts: { host: string; port: number }, cb?: () => void) => BridgeServer;
  address: () => { port: number; address: string } | null;
  close: (cb?: () => void) => void;
};
