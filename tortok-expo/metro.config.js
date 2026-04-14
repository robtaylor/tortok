// Metro configuration for TorTok Expo.
//
// WebTorrent and its dependency chain were written for Node. Running them on
// Hermes requires Node-core shims wired through Metro's resolver. See
// `lib/webtorrent/polyfills.ts` for the matching runtime global setup, and
// ADR-009 for the Phase 2 WebTorrent spike context.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Prefer the `browser` condition when packages (like webrtc-polyfill) expose
// conditional exports. The Node entry points use `node:`-prefixed imports and
// assume libdatachannel bindings; the browser entry points just read
// globalThis.RTCPeerConnection etc., which we populate from
// react-native-webrtc in lib/webtorrent/polyfills.ts.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['require', 'browser'];

// Node-core shims. Packages WebTorrent transitively imports like `crypto`,
// `stream`, `events`, `buffer`, `process` need concrete implementations on
// Hermes. `net`/`dns`/`tls`/`fs` are stubbed — WebTorrent only exercises the
// WebRTC transport in our target environment, and the Node TCP/uTP paths are
// unreachable from a mobile runtime anyway.
const emptyModule = path.resolve(__dirname, 'lib/webtorrent/empty.js');

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  crypto: require.resolve('react-native-quick-crypto'),
  stream: require.resolve('readable-stream'),
  // For packages whose name collides with a Node built-in,
  // resolve via package.json to avoid Node's built-in-priority
  // require.resolve behaviour.
  buffer: path.dirname(require.resolve('buffer/package.json')),
  events: path.dirname(require.resolve('events/package.json')),
  process: path.dirname(require.resolve('process/package.json')),
  path: path.dirname(require.resolve('path-browserify/package.json')),
  util: path.dirname(require.resolve('util/package.json')),
  url: path.dirname(require.resolve('url/package.json')),
  os: path.dirname(require.resolve('os-browserify/package.json')),
  querystring: path.dirname(require.resolve('querystring-es3/package.json')),
  assert: path.dirname(require.resolve('assert/package.json')),
  // Unreachable-on-mobile modules — stub rather than polyfill.
  net: emptyModule,
  dns: emptyModule,
  tls: emptyModule,
  fs: emptyModule,
  http: emptyModule,
  https: emptyModule,
};

module.exports = config;
