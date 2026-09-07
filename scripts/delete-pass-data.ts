// GDPR Art. 17 deletion path (operator CLI). Erases a customer's PII by pass
// id or by email:
//   npx tsx scripts/delete-pass-data.ts <passId|email>
//
// Effect (same logic the API's DELETE /owner/pass/:id/pii uses, see
// apps/api/src/privacy/erase-pii.ts): email and marketing-consent timestamp
// are nulled on every matching pass; the pass itself and its events are kept
// (they are already anonymized — no event ever stores the email), and each
// erasure is audited as a 'pii_erased' event.
import postgres from 'postgres';
import { erasePassesPii } from '../apps/api/src/privacy/erase-pii.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const [target] = process.argv.slice(2);
  if (!target) {
    console.error('usage: npx tsx scripts/delete-pass-data.ts <passId|email>');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const rows = UUID_RE.test(target)
      ? await sql`select id from passes where id = ${target}`
      : await sql`select id from passes where email = ${target}`;
    if (rows.length === 0) {
      console.error(`no pass found for "${target}" — nothing erased`);
      process.exitCode = 1;
      return;
    }
    const erased = await erasePassesPii(
      sql,
      rows.map((r) => r.id as string),
      { staffId: null, source: 'cli' },
    );
    for (const pass of erased) {
      console.log(`erased PII of pass ${pass.passId} (cafe ${pass.cafeId})`);
    }
    console.log(`${erased.length} pass(es) erased; anonymized events kept`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
