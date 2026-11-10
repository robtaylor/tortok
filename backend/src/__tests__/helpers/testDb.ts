// A throwaway Postgres database per test file, with schema.sql applied
// (Decision 0016: integration tests run against a real Postgres).
//
// Needs a Postgres server; TEST_PG_ADMIN_URL points at any database the
// test user can CREATE DATABASE from (default: the local dev server).
// Load ../../db only after createTestDb(), with a dynamic import, because
// it reads DATABASE_URL when it's first imported.

import { Client } from 'pg';

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://localhost:5432/postgres';

export interface TestDb {
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `tortok_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  return {
    async drop() {
      const c = new Client({ connectionString: ADMIN_URL });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}
