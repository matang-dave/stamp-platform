// Creates a tenant: a cafe (defaults: 10 stamps, vouchers never expire) plus
// an owner staff row with a random 4-digit PIN, and prints the enrollment URL
// and the PIN. Run from the repo root:
//   npx tsx scripts/create-tenant.ts "Café Kranz" cafe-kranz
import { randomInt } from 'node:crypto';
import postgres from 'postgres';
import { hashPin } from '../apps/api/src/auth/pin.ts';

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
  const [name, slug] = process.argv.slice(2);
  if (!name || !slug) {
    console.error('usage: npx tsx scripts/create-tenant.ts "<cafe name>" <slug>');
    process.exit(1);
  }

  const pin = String(randomInt(0, 10_000)).padStart(4, '0');
  const pinHash = await hashPin(pin);

  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const cafe = await sql.begin(async (tx) => {
      const [cafe] = await tx`
        insert into cafes (name, slug) values (${name}, ${slug}) returning id, slug`;
      await tx`
        insert into staff (cafe_id, name, role, pin_hash)
        values (${cafe!.id}, 'owner', 'owner', ${pinHash})`;
      return cafe!;
    });
    const base = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    console.log(`cafe:           ${name} (${cafe.id})`);
    console.log(`enrollment URL: ${base}/c/${cafe.slug}`);
    console.log(`owner login:    staff "owner", PIN ${pin}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
