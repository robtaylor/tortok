// Web variant of the WebTorrent compat layer. Browsers already ship every
// global the Hermes side has to manufacture (RTCPeerConnection, crypto with
// SubtleCrypto + getRandomValues, etc.) — and `app/+html.tsx` injects a
// `process` shim into globalThis BEFORE the Metro bundle preamble runs, so
// by the time this module loads the only thing still missing is `Buffer`.
// See `polyfills.native.ts` for the much larger Hermes setup and ADR-009
// for context.

import { Buffer } from 'buffer';

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof Buffer;
}

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
