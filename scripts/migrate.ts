// Applies db/migrations/*.sql in filename order, recording each in a
// migrations table so already-applied files are skipped. Run from the repo
// root: `npm run db:migrate`.
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

// Load repo-root .env when DATABASE_URL isn't already exported.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env present; rely on the environment
  }
}

// Root package.json is CommonJS, so tsx compiles this file without
// top-level await support; run everything inside an async main instead.
async function main() {
  // onnotice: silence "relation already exists, skipping" on re-runs.
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  await sql`create table if not exists migrations (name text primary key, applied_at timestamptz default now())`;
  const applied = new Set((await sql`select name from migrations`).map((r) => r.name));
  for (const f of (await readdir('db/migrations')).sort()) {
    if (applied.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(`db/migrations/${f}`, 'utf8'));
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
