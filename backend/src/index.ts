import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import path from 'path';
import { initializeDatabase } from './db';
import authRoutes from './routes/auth';
import videoRoutes from './routes/videos';
import { seeder } from './services/seeder';
import { bskyFirehose } from './services/bskyFirehose';
import { bskyEngagementPoller } from './services/bskyEngagementPoller';
import { bskyMirror } from './services/bskyMirror';

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS === '*' || !process.env.ALLOWED_ORIGINS
    ? true
    : process.env.ALLOWED_ORIGINS.split(','),
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Serve static content (video files, HLS segments for legacy seeder)
app.use('/content', express.static(path.join(__dirname, '../content'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    // Allow cross-origin access
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    instance: process.env.INSTANCE_DOMAIN || 'localhost',
  });
});

// Seeder stats
app.get('/seeder/stats', (req, res) => {
  const stats = seeder.getStats();
  res.json({
    ...stats,
    uploadSpeedKBps: (stats.uploadSpeed / 1024).toFixed(2),
    torrents: seeder.getSeededTorrents()
  });
});

// Instance info (for discovery)
app.get('/.well-known/tortok', (req, res) => {
  res.json({
    name: process.env.INSTANCE_NAME || 'TorTok Instance',
    version: '1.0.0',
    description: 'TorTok federated metadata server',
    registrationOpen: true,
    federationEnabled: false, // TODO: Implement federation
    supportedProtocols: ['tortok-v1'],
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
app.use('/auth', authRoutes);
app.use('/videos', videoRoutes);

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

    // Initialize WebTorrent seeder
    try {
      await seeder.initialize();
      console.log('🌱 WebTorrent seeder initialized');
    } catch (err) {
      console.warn('⚠️ Failed to initialize seeder:', err);
      // Continue without seeder - not critical
    }

    // Phase 3 Unit 2.5 — start the Bluesky Jetstream subscriber.
    // Indexes inbound video posts into `bridged_posts (state=pending)`.
    // Failures here are non-fatal; bridge can come up later.
    try {
      await bskyFirehose.start();
      console.log('🔵 Bluesky Jetstream subscriber started');
    } catch (err) {
      console.warn('⚠️ Failed to start Bluesky Jetstream subscriber:', err);
    }

    // Phase 3 Unit 2.5 — start the engagement poller (slice 2).
    // Promotes `pending` rows to `mirrored` once an engagement
    // signal crosses threshold; declines rows older than
    // BSKY_DECLINE_AFTER_DAYS that never qualified. Non-fatal on
    // failure — feed degrades to native-only until poller recovers.
    try {
      bskyEngagementPoller.start();
      console.log('📊 Bluesky engagement poller started');
    } catch (err) {
      console.warn('⚠️ Failed to start Bluesky engagement poller:', err);
    }

    // Phase 3 Unit 2.5 — start the mirror pipeline (slice 3).
    // Mirror loop copies HLS bytes from Bluesky's CDN into R2 +
    // generates a .torrent for any `mirrored AND r2_path IS NULL`
    // row, so client playback uses ADR-008's pipeline (R2 = origin,
    // our trackers = discovery, webseed via R2). Decay loop expires
    // unwatched mirrors after BSKY_DECAY_DAYS. Non-fatal on failure.
    try {
      bskyMirror.start();
      console.log('🪞 Bluesky mirror pipeline started');
    } catch (err) {
      console.warn('⚠️ Failed to start Bluesky mirror pipeline:', err);
    }

    // Start listening
    app.listen(PORT, () => {
      console.log('');
      console.log('🚀 TorTok Metadata Server');
      console.log('==========================');
      console.log(`📡 Server running on port ${PORT}`);
      console.log(`🌍 Instance: ${process.env.INSTANCE_DOMAIN || 'localhost'}`);
      console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌱 Seeder: ${seeder.getSeededTorrents().length} torrents`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  bskyMirror.stop();
  bskyEngagementPoller.stop();
  bskyFirehose.stop();
  await seeder.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...');
  bskyMirror.stop();
  bskyEngagementPoller.stop();
  bskyFirehose.stop();
  await seeder.destroy();
  process.exit(0);
});

start();
