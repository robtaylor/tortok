// Metro configuration for TorTok Expo.
//
// WebTorrent and its dependency chain were written for Node. Running them on
// Hermes requires Node-core shims wired through Metro's resolver. See
// `lib/webtorrent/polyfills.ts` for the matching runtime global setup, and
// ADR-009 for the Phase 2 WebTorrent spike context.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

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
  // Trailing slash forces Node to resolve the npm package rather than the
  // built-in of the same name.
  buffer: path.dirname(require.resolve('buffer/package.json')),
  events: path.dirname(require.resolve('events/package.json')),
  process: path.dirname(require.resolve('process/package.json')),
  // Unreachable-on-mobile modules — stub rather than polyfill.
  net: emptyModule,
  dns: emptyModule,
  tls: emptyModule,
  fs: emptyModule,
  http: emptyModule,
  https: emptyModule,
};

module.exports = config;
