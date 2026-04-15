// Empty module used by Metro to stub Node-core packages that WebTorrent
// transitively imports but cannot exercise on Hermes (net, dns, tls, fs, etc.).
// WebTorrent's WebRTC transport doesn't need any of these; the TCP/uTP paths
// that would are unreachable from a mobile runtime. See metro.config.js.

module.exports = {};
