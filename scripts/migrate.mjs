// Plain-Node port of scripts/migrate.ts for environments without devDependencies
// (tsx is a devDependency, so the TypeScript runner is unavailable after
// `npm install --omit=dev` — e.g. on Elastic Beanstalk instances).
//
// Applies db/migrations/*.sql in filename order, recording each in a
// migrations table so already-applied files are skipped. Paths resolve
// relative to this file, so it works from any cwd:
//   node scripts/migrate.mjs
//
// Requires DATABASE_URL in the environment (or a repo-root .env).
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(join(repoRoot, '.env'));
  } catch {
    // no .env present; rely on the environment
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  // onnotice: silence "relation already exists, skipping" on re-runs.
  const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
  await sql`create table if not exists migrations (name text primary key, applied_at timestamptz default now())`;
  const applied = new Set((await sql`select name from migrations`).map((r) => r.name));
  const migrationsDir = join(repoRoot, 'db', 'migrations');
  for (const f of (await readdir(migrationsDir)).sort()) {
    if (applied.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(join(migrationsDir, f), 'utf8'));
      await tx`insert into migrations (name) values (${f})`;
    });
    console.log('applied', f);
  }
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
