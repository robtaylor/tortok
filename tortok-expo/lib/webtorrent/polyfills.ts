// Runtime globals that WebTorrent (and its Node-targeted deps) expect to
// exist before any code runs. Import this module FIRST, before any
// `import WebTorrent` — the order matters because some deps capture globals
// during their own module-init.
//
// See metro.config.js for the matching module-resolution side. ADR-009 for
// the Phase 2 spike context.

import { Buffer } from 'buffer';
import process from 'process';

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof Buffer;
  // eslint-disable-next-line no-var
  var process: typeof process;
}

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

if (typeof global.process === 'undefined') {
  global.process = process;
}

// `nextTick` is expected by readable-stream and a handful of WebTorrent
// internals. Hermes' process shim ships it, but belt-and-braces for web too.
if (typeof global.process.nextTick !== 'function') {
  global.process.nextTick = (cb: (...args: unknown[]) => void, ...args: unknown[]) => {
    setTimeout(() => cb(...args), 0);
  };
}
