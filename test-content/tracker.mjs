import Server from 'bittorrent-tracker/server';

const port = 8000;

const server = new Server({
  udp: false,
  http: true, // needed so ws can piggyback on the http server
  ws: true,
  stats: true,
  filter: (infoHash, params, cb) => {
    // allow everything — this is a local dev tracker
    cb(null);
  }
});

server.on('error', (err) => {
  console.error('❌ tracker error:', err.message);
});

server.on('warning', (err) => {
  console.warn('⚠️  tracker warning:', err.message);
});

server.on('listening', () => {
  const wsAddr = server.ws.address();
  console.log(`✅ local tracker listening on ws://localhost:${wsAddr.port}`);
});

server.on('start', (addr) => {
  console.log('▶️  peer start from', addr);
});

server.on('complete', (addr) => {
  console.log('✔️  peer complete from', addr);
});

server.on('update', (addr) => {
  console.log('🔄 peer update from', addr);
});

server.on('stop', (addr) => {
  console.log('⏹️  peer stop from', addr);
});

server.listen(port, '0.0.0.0');

process.on('SIGINT', () => {
  console.log('\n🛑 tracker shutting down');
  server.close(() => process.exit(0));
});
