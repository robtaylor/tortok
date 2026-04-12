import { Server } from 'bittorrent-tracker'

const PORT = parseInt(process.env.PORT || '8080', 10)

const server = new Server({
  udp: false,     // WebTorrent doesn't use UDP
  http: true,     // HTTP announce (health check + stats)
  ws: true,       // WebSocket — the critical path for WebTorrent
  stats: true,    // Enable /stats endpoint
  filter: (infoHash, params, cb) => {
    // Accept all torrents. A future version could restrict to
    // known TorTok info hashes by checking against the API.
    cb(null)
  }
})

server.on('error', (err) => {
  console.error('Tracker error:', err.message)
})

server.on('warning', (err) => {
  console.warn('Tracker warning:', err.message)
})

server.on('listening', () => {
  console.log(`TorTok tracker listening on port ${PORT}`)
  console.log(`  HTTP announce: http://0.0.0.0:${PORT}/announce`)
  console.log(`  WebSocket:     ws://0.0.0.0:${PORT}`)
  console.log(`  Stats:         http://0.0.0.0:${PORT}/stats`)
})

server.listen(PORT)

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  server.close(() => {
    console.log('Tracker closed')
    process.exit(0)
  })
})
