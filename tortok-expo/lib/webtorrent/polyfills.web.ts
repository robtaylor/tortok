// Web variant of the WebTorrent compat layer. Browsers already ship every
// global the Hermes side has to manufacture (RTCPeerConnection, crypto with
// SubtleCrypto + getRandomValues, etc.), so the only things we need to install
// are the Node-shaped Buffer/process shims that webtorrent's transitive deps
// expect. See `polyfills.native.ts` for the much larger Hermes setup and
// ADR-009 for context.

import { Buffer } from 'buffer';
import process from 'process';

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof Buffer;
  // eslint-disable-next-line no-var
  var process: typeof process;
}

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

if (typeof globalThis.process === 'undefined') {
  globalThis.process = process;
}

// `process.browser` is the truthy flag bittorrent-discovery / bittorrent-tracker
// branch on to skip Node-only socket paths. On the actual browser this is
// already a no-op for most libs, but uint8-util and a few others still read it.
(globalThis.process as unknown as { browser?: boolean }).browser = true;
