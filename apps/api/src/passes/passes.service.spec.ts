import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbModule } from '../db/db.module.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { PassesModule } from './passes.module.js';
import { PassesService } from './passes.service.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

describe('PassesService (integration)', () => {
  let moduleRef: TestingModule;
  let passes: PassesService;
  let sql: Sql;
  // Unique slug per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  let cafeId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [DbModule, PassesModule] }).compile();
    passes = moduleRef.get(PassesService);
    sql = moduleRef.get<Sql>(SQL);

    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug, stamps_required)
      values ('Café Passes', ${`cafe-passes-${run}`}, 6) returning id`;
  });

  afterAll(async () => {
    await sql`delete from events where cafe_id = ${cafeId}`;
    await sql`delete from vouchers where pass_id in (select id from passes where cafe_id = ${cafeId})`;
    await sql`delete from passes where cafe_id = ${cafeId}`;
    await sql`delete from cafes where id = ${cafeId}`;
    await moduleRef.close();
    await sql.end();
  });

  it('createPass stores email and consent timestamp only on explicit true', async () => {
    const anonymous = await passes.createPass({ cafeId, platform: 'apple' });
    expect(anonymous.email).toBeNull();
    expect(anonymous.marketingConsentAt).toBeNull();

    const withEmail = await passes.createPass({
      cafeId,
      platform: 'google',
      email: 'p@example.com',
      marketingConsent: false,
    });
    expect(withEmail.email).toBe('p@example.com');
    expect(withEmail.marketingConsentAt).toBeNull();

    const consented = await passes.createPass({
      cafeId,
      platform: 'google',
      email: 'c@example.com',
      marketingConsent: true,
    });
    expect(consented.marketingConsentAt).toBeInstanceOf(Date);
  });

  it('findById returns the pass or null', async () => {
    const created = await passes.createPass({ cafeId, platform: 'apple' });
    const found = await passes.findById(created.id);
    expect(found).toMatchObject({ id: created.id, cafeId, platform: 'apple', stamps: 0 });
    expect(await passes.findById(randomUUID())).toBeNull();
  });

  it('findWithCafe returns pass plus cafe branding for wallet rendering', async () => {
    const created = await passes.createPass({ cafeId, platform: 'google' });
    const result = await passes.findWithCafe(created.id);
    expect(result).not.toBeNull();
    expect(result!.pass.id).toBe(created.id);
    expect(result!.cafe).toMatchObject({
      id: cafeId,
      name: 'Café Passes',
      brandColor: '#000000',
      stampsRequired: 6,
      status: 'active',
    });
    expect(await passes.findWithCafe(randomUUID())).toBeNull();
  });

  it('getSummary counts only live vouchers and reports the last stamp time', async () => {
    const created = await passes.createPass({ cafeId, platform: 'apple' });
    await sql`update passes set stamps = 3 where id = ${created.id}`;
    // one live voucher, one redeemed, one expired
    await sql`insert into vouchers (pass_id) values (${created.id})`;
    await sql`insert into vouchers (pass_id, redeemed_at) values (${created.id}, now())`;
    await sql`insert into vouchers (pass_id, expires_at) values (${created.id}, now() - interval '1 day')`;
    const stampedAt = new Date('2026-01-02T03:04:05.000Z');
    await sql`
      insert into events (cafe_id, pass_id, action, created_at)
      values (${cafeId}, ${created.id}, 'stamp', ${stampedAt})`;

    const summary = await passes.getSummary(created.id);
    expect(summary).toEqual({
      passId: created.id,
      stamps: 3,
      stampsRequired: 6,
      vouchersAvailable: 1,
      lastStampAt: stampedAt.toISOString(),
    });
    expect(await passes.getSummary(randomUUID())).toBeNull();
  });

  it('getSummary reports null lastStampAt for a fresh pass', async () => {
    const created = await passes.createPass({ cafeId, platform: 'google' });
    const summary = await passes.getSummary(created.id);
    expect(summary).toMatchObject({ stamps: 0, vouchersAvailable: 0, lastStampAt: null });
  });
});
