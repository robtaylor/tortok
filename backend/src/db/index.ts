import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

// Cloud SQL via Unix socket (Cloud Run) doesn't use SSL
const databaseUrl = process.env.DATABASE_URL || '';
const isUnixSocket = databaseUrl.includes('host=/cloudsql');

const pool = new Pool({
  connectionString: databaseUrl,
  // Only use SSL for TCP connections, not Unix sockets
  ssl: !isUnixSocket && process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

/**
 * Execute a query
 */
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (process.env.NODE_ENV === 'development') {
    console.log('Executed query', { text, duration, rows: result.rowCount });
  }

  return result.rows;
}

/**
 * Get a client from the pool (for transactions)
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Initialize database schema
 */
export async function initializeDatabase(): Promise<void> {
  try {
    console.log('🔄 Initializing database schema...');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    console.log('✅ Database schema initialized');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Close database connection pool
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  console.log('Database connection pool closed');
}

export default { query, getClient, initializeDatabase, closeDatabase };
