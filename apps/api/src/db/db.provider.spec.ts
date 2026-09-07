import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSql } from './db.provider.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

describe('createSql', () => {
  it('connects and executes a trivial query', async () => {
    const sql = createSql(process.env.DATABASE_URL!);
    const [row] = await sql`select 1 as one`;
    expect(row!.one).toBe(1);
    await sql.end();
  });
});
