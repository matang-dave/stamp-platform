// GDPR Art. 17 erasure, shared between the API (privacy.service) and the
// operator CLI (scripts/delete-pass-data.ts) — deliberately decorator-free so
// tsx can import it directly.
//
// What erasure means here: the pass row survives (stamps/vouchers keep
// working — erasure is not a wallet revocation), but every piece of PII is
// nulled: email and the marketing-consent timestamp. Events are KEPT: they
// never contain the email (the enroll event only records `emailProvided`),
// so the audit trail stays intact and anonymized. Each erasure appends its
// own 'pii_erased' audit event.
import type postgres from 'postgres';

// Works on the pool or inside a transaction (shared base of Sql/TransactionSql).
type Queryable = postgres.ISql<NonNullable<unknown>>;

export interface ErasedPass {
  passId: string;
  cafeId: string;
}

export async function erasePassesPii(
  sql: Queryable,
  passIds: string[],
  opts: { staffId?: string | null; source: 'api' | 'cli' },
): Promise<ErasedPass[]> {
  const erased: ErasedPass[] = [];
  for (const passId of passIds) {
    const [row] = await sql`
      update passes
      set email = null, marketing_consent_at = null
      where id = ${passId}
      returning id as "passId", cafe_id as "cafeId"`;
    if (!row) continue;
    await sql`
      insert into events (cafe_id, staff_id, pass_id, action, detail)
      values (${row.cafeId as string}, ${opts.staffId ?? null}, ${row.passId as string},
              'pii_erased', ${sql.json({ source: opts.source })})`;
    erased.push({ passId: row.passId as string, cafeId: row.cafeId as string });
  }
  return erased;
}
