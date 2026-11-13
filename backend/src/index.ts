import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import http from 'http';
import { promisify } from 'util';
import { initializeDatabase, closeDatabase, query } from './db';
import videoRoutes from './routes/videos';
import { createBlobRouter } from './routes/blob';
import { ingestFromEnv } from './services/atprotoIngest';
import { bridgeFromEnv } from './services/bskyBridge';

const app = express();
const PORT = process.env.PORT || 8080;
let server: http.Server | undefined;
const ingest = ingestFromEnv();
// The Bluesky bridge (Decision 0023), in this process for v1 (step 15
// measured the stream well inside one shared CPU). Null unless BRIDGE_ENABLED.
const bridge = bridgeFromEnv();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS === '*' || !process.env.ALLOWED_ORIGINS
    ? true
    : process.env.ALLOWED_ORIGINS.split(','),
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health check: liveness, so it answers 200 whenever the process is serving.
// The server only listens once start() has reached Postgres, so passing it
// also gates Fly's blue-green deploys on the database. After that, a
// Postgres outage is reported (`database`) rather than failing the check,
// so Fly doesn't route around the only machine and take down routes that
// don't need the database; the smoke check (scripts/smoke.mjs) fails on it.
// `sha` and `buildTime` are the image's Dockerfile build args.
app.get('/health', async (req, res) => {
  const dbOk = await query('SELECT 1').then(() => true, () => false);
  res.json({
    status: 'healthy',
    database: dbOk ? 'ok' : 'unreachable',
    sha: process.env.GIT_SHA || null,
    buildTime: process.env.BUILD_TIME || null,
    timestamp: new Date().toISOString(),
    instance: process.env.INSTANCE_DOMAIN || 'localhost',
  });
});

// TURN credential endpoint — returns time-limited HMAC credentials
// for WebRTC NAT traversal. Uses the same shared secret as coturn.
app.get('/turn/credentials', (req, res) => {
  const secret = process.env.TURN_SECRET;
  if (!secret) {
    res.json({ iceServers: [{ urls: 'stun:tortok-turn.fly.dev:3478' }] });
    return;
  }

  const ttl = 24 * 60 * 60; // 24 hours
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:tortok`;
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  res.json({
    iceServers: [
      { urls: 'stun:tortok-turn.fly.dev:3478' },
      {
        urls: 'turn:tortok-turn.fly.dev:3478',
        username,
        credential,
      }
    ],
    ttl,
  });
});

// Routes
app.use('/videos', videoRoutes);
app.use('/blob', createBlobRouter());

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
async function start() {
  try {
    // Initialize database
    await initializeDatabase();

    // Index atproto records, and the bridge's candidates, concurrently: each
    // has its own socket and cursor. A failure is fatal: the feed reads this
    // index, and the bridge's start only reads its cursor and opens the
    // socket, so its failing means Postgres is gone.
    await Promise.all([ingest.start(), bridge?.start()]);
    if (!bridge) console.log('[bridge] off (BRIDGE_ENABLED is not true)');

    // Start listening
    server = app.listen(PORT, () => {
      console.log('');
      console.log('🚀 TorTok Metadata Server');
      console.log('==========================');
      console.log(`📡 Server running on port ${PORT}`);
      console.log(`🌍 Instance: ${process.env.INSTANCE_DOMAIN || 'localhost'}`);
      console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown. Fly.io sends SIGINT by default (fly.toml can
// override it), docker/dev-down send SIGTERM, Ctrl+C sends SIGINT — handle
// both. Order: stop accepting HTTP, ingest and the bridge, then close the pool,
// under a hard deadline so a stuck step can't block the platform's kill.
const SHUTDOWN_DEADLINE_MS = 8000;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  setTimeout(() => {
    console.error(`Shutdown exceeded ${SHUTDOWN_DEADLINE_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();

  try {
    // Stop accepting HTTP and ingest concurrently; only the DB pool has to
    // wait for in-flight requests to drain.
    const httpClosed = server ? promisify(server.close.bind(server))() : undefined;
    // Idle keep-alive sockets would otherwise hold close() open.
    server?.closeIdleConnections();
    await Promise.all([httpClosed, ingest.stop(), bridge?.stop()]);
    console.log('HTTP server closed');
    await closeDatabase();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start();
