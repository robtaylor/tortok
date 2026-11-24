import { Pool } from 'pg';
import type { QueryConfig } from 'pg';
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
 * How long a query may take before it is given up as failed. Without a
 * bound, a query on a dead connection never settles, and whatever awaits it
 * (a Jetstream handler, the poller) stops for good without a word.
 */
const QUERY_TIMEOUT_MS = 30_000;

/**
 * A parameter as Postgres can store it. Its text can't hold U+0000, and one in
 * a parameter fails the whole statement, every time it is tried. Network JSON
 * has them dropped where it is parsed (atproto/json.ts); this is the backstop
 * for a string that came some other way, such as a request's path.
 */
function storable(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('\u0000', '');
  return Array.isArray(value) ? value.map(storable) : value;
}

/**
 * Execute a query. It rejects if no answer comes within `timeoutMs`; the
 * schema bootstrap doesn't go through here, so it stays unbounded.
 */
export async function query<T = any>(text: string, params?: any[], timeoutMs = QUERY_TIMEOUT_MS): Promise<T[]> {
  const start = Date.now();
  // node-postgres reads query_timeout off a query's config; its types only list it for the pool.
  const config: QueryConfig & { query_timeout: number } =
    { text, values: params?.map(storable), query_timeout: timeoutMs };
  const result = await pool.query(config);
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
