// Runtime globals that WebTorrent (and its Node-targeted deps) expect to
// exist before any code runs. Import this module FIRST, before any
// `import WebTorrent` — the order matters because some deps capture globals
// during their own module-init.
//
// See metro.config.js for the matching module-resolution side. ADR-009 for
// the Phase 2 spike context.

import { Buffer } from 'buffer';
import process from 'process';
import QuickCrypto from 'react-native-quick-crypto';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
  MediaStreamTrack,
  RTCRtpReceiver,
  RTCRtpSender,
} from 'react-native-webrtc';

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

// Many torrent libs (bittorrent-discovery, bittorrent-tracker) branch on
// `process.browser` — truthy means "skip Node-only code paths, use WebRTC
// transport". Hermes + react-native is not a browser, but behaviourally it
// matches the browser profile (no TCP/UDP sockets available to us), so
// force-set it before anything torrent-related loads.
(global.process as unknown as { browser?: boolean }).browser = true;

// `nextTick` is expected by readable-stream and a handful of WebTorrent
// internals. Hermes' process shim ships it, but belt-and-braces for web too.
if (typeof global.process.nextTick !== 'function') {
  global.process.nextTick = (cb: (...args: unknown[]) => void, ...args: unknown[]) => {
    setTimeout(() => cb(...args), 0);
  };
}

// webtorrent → @thaunknown/simple-peer → webrtc-polyfill. The browser entry
// of webrtc-polyfill (which Metro resolves via the "browser" condition in
// metro.config.js) reads RTCPeerConnection et al. off the global scope. On
// Hermes there is no such global, so we have to populate it from
// react-native-webrtc ourselves.
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.RTCPeerConnection === 'undefined') {
  g.RTCPeerConnection = RTCPeerConnection;
  g.RTCSessionDescription = RTCSessionDescription;
  g.RTCIceCandidate = RTCIceCandidate;
  g.MediaStream = MediaStream;
  g.MediaStreamTrack = MediaStreamTrack;
  g.RTCRtpReceiver = RTCRtpReceiver;
  g.RTCRtpSender = RTCRtpSender;
}

// @thaunknown/simple-peer branches on `pc.getStats.length` to decide between
// Promise-style (arity 0, modern browsers) and callback-style (arity > 0,
// legacy). react-native-webrtc declares `getStats(selector?)` → arity 1, so
// simple-peer takes the callback branch and passes its own callback as the
// `selector` argument, which blows up with "Invalid selector: could not find
// matching sender / receiver". Wrap the prototype to hide the optional arg.
const pcProto = (RTCPeerConnection as unknown as { prototype: { getStats: (s?: unknown) => Promise<unknown> } }).prototype;
const origGetStats = pcProto.getStats;
if (origGetStats.length > 0) {
  pcProto.getStats = function () {
    return origGetStats.call(this);
  };
}

// uint8-util (used by webtorrent for peerId/nodeId generation) reads
// `self.crypto.getRandomValues` at module-init time. Hermes doesn't ship a
// `crypto` global, and `self` === globalThis here. Install QuickCrypto as
// `globalThis.crypto` BEFORE webtorrent is required so uint8-util latches
// onto a working getRandomValues. (Metro's `crypto` alias only rewrites
// `import/require 'crypto'`; it doesn't reach these dynamic reads.)
if (typeof g.crypto === 'undefined' || typeof (g.crypto as { getRandomValues?: unknown }).getRandomValues !== 'function') {
  g.crypto = QuickCrypto;
}

// QuickCrypto's SubtleCrypto does strict uppercase matching against
// SUPPORTED_ALGORITHMS (e.g., 'SHA-1'). The WebCrypto spec says algorithm
// names are case-insensitive — and uint8-util (used by bittorrent-protocol
// for piece hashing) passes 'sha-1' lowercase. Wrap digest to uppercase.
const subtle = (g.crypto as { subtle?: { digest?: (a: unknown, d: unknown) => Promise<ArrayBuffer> } }).subtle;
if (subtle?.digest) {
  const origDigest = subtle.digest.bind(subtle);
  subtle.digest = (algo: unknown, data: unknown) => {
    if (typeof algo === 'string') {
      return origDigest(algo.toUpperCase(), data);
    }
    if (algo && typeof algo === 'object' && 'name' in algo && typeof (algo as { name: unknown }).name === 'string') {
      return origDigest({ ...(algo as object), name: (algo as { name: string }).name.toUpperCase() }, data);
    }
    return origDigest(algo, data);
  };
}
