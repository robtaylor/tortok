import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

// Dev default matches scripts/dev-up.sh;
// prod must set DATABASE_URL explicitly (we'd rather fail fast than
// silently connect to nothing).
// Under Jest, never the dev default: a test that loads this module before
// createTestDb() sets DATABASE_URL would otherwise read and write the dev
// database. That address can't resolve, so such a test fails loudly.
const databaseUrl = process.env.DATABASE_URL ??
  (process.env.JEST_WORKER_ID !== undefined
    ? 'postgresql://database-url-not-set-in-test.invalid/none'
    : process.env.NODE_ENV !== 'production'
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
  // SSL is governed by DATABASE_URL's `sslmode` (node-postgres lets the
  // parsed connection string override this config). Production on Fly uses
  // `sslmode=disable` over the private, WireGuard-encrypted 6PN network.
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

export type QueryFn = typeof query;

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

export default { query, initializeDatabase, closeDatabase };
