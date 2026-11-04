import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

// Dev default matches scripts/dev-up.sh + test-content/seed-db.mjs;
// prod must set DATABASE_URL explicitly (we'd rather fail fast than
// silently connect to nothing).
const databaseUrl = process.env.DATABASE_URL ??
  (process.env.NODE_ENV !== 'production'
    ? 'postgresql://localhost:5432/tortok'
    : '');
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. In production this is required; in development ' +
      'the default is postgresql://localhost:5432/tortok (set NODE_ENV=development ' +
      'or set DATABASE_URL explicitly).'
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
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
