import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { initializeDatabase } from './db';
import authRoutes from './routes/auth';
import videoRoutes from './routes/videos';
import { authenticateJWT } from './middleware/auth';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    instance: process.env.INSTANCE_DOMAIN || 'localhost',
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

// Routes
app.use('/auth', authRoutes);
app.use('/videos', videoRoutes);

// Protect /auth/me endpoint
app.use('/auth/me', authenticateJWT);

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

    // Start listening
    app.listen(PORT, () => {
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

start();
