import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { hashPin } from '../auth/pin.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

describe('GDPR deletion path: DELETE /owner/pass/:id/pii (integration)', () => {
  let app: INestApplication;
  let sql: Sql;
  // Unique slugs per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slugA = `privacy-a-${run}`;
  const slugB = `privacy-b-${run}`;
  let cafeAId: string;
  let cafeBId: string;
  let ownerAId: string;
  let baristaAId: string;
  let ownerToken: string;
  let baristaToken: string;
  let ownerBToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeAId }] = await sql`
      insert into cafes (name, slug) values ('Privacy A', ${slugA}) returning id`;
    [{ id: cafeBId }] = await sql`
      insert into cafes (name, slug) values ('Privacy B', ${slugB}) returning id`;
    [{ id: ownerAId }] = await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeAId}, 'olivia', 'owner', ${await hashPin('1111')}) returning id`;
    [{ id: baristaAId }] = await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeAId}, 'bea', 'barista', ${await hashPin('2222')}) returning id`;
    await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeBId}, 'otto', 'owner', ${await hashPin('3333')})`;

    ownerToken = await login(slugA, 'olivia', '1111');
    baristaToken = await login(slugA, 'bea', '2222');
    ownerBToken = await login(slugB, 'otto', '3333');
  });

  afterAll(async () => {
    await sql`delete from events where cafe_id in (${cafeAId}, ${cafeBId})`;
    await sql`delete from vouchers where pass_id in
      (select id from passes where cafe_id in (${cafeAId}, ${cafeBId}))`;
    await sql`delete from passes where cafe_id in (${cafeAId}, ${cafeBId})`;
    await sql`delete from staff where cafe_id in (${cafeAId}, ${cafeBId})`;
    await sql`delete from cafes where id in (${cafeAId}, ${cafeBId})`;
    await app.close();
    await sql.end();
  });

  async function login(cafeSlug: string, staffName: string, pin: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ cafeSlug, staffName, pin });
    expect(res.status).toBe(201);
    return res.body.token as string;
  }

  async function enrollWithPii(): Promise<string> {
    const [{ id }] = await sql`
      insert into passes (cafe_id, platform, email, marketing_consent_at)
      values (${cafeAId}, 'google', 'customer@example.com', now()) returning id`;
    // Existing anonymized audit history that erasure must keep.
    await sql`
      insert into events (cafe_id, staff_id, pass_id, action, detail)
      values (${cafeAId}, ${baristaAId}, ${id}, 'stamp', ${sql.json({ count: 1 })})`;
    return id as string;
  }

  function del(passId: string, token: string) {
    return request(app.getHttpServer())
      .delete(`/owner/pass/${passId}/pii`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('requires an authenticated owner (401 anonymous, 403 barista)', async () => {
    const passId = await enrollWithPii();
    await request(app.getHttpServer()).delete(`/owner/pass/${passId}/pii`).expect(401);
    await del(passId, baristaToken).expect(403);
    const [pass] = await sql`select email from passes where id = ${passId}`;
    expect(pass!.email).toBe('customer@example.com');
  });

  it('is tenancy-safe: another café’s owner gets 403 and nothing changes', async () => {
    const passId = await enrollWithPii();
    await del(passId, ownerBToken).expect(403);
    const [pass] = await sql`select email from passes where id = ${passId}`;
    expect(pass!.email).toBe('customer@example.com');
  });

  it('404s for unknown and malformed pass ids', async () => {
    await del(randomUUID(), ownerToken).expect(404);
    await del('not-a-uuid', ownerToken).expect(404);
  });

  it('nulls email + consent, keeps the pass and its anonymized events, audits the erasure', async () => {
    const passId = await enrollWithPii();
    const res = await del(passId, ownerToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ erased: true });

    const [pass] = await sql`
      select email, marketing_consent_at, stamps from passes where id = ${passId}`;
    expect(pass).toEqual({ email: null, marketingConsentAt: null, stamps: 0 });

    // Anonymized audit history survives; the erasure itself is audited.
    const events = await sql`
      select staff_id, action from events where pass_id = ${passId} order by id`;
    expect(events).toEqual([
      expect.objectContaining({ staffId: baristaAId, action: 'stamp' }),
      expect.objectContaining({ staffId: ownerAId, action: 'pii_erased' }),
    ]);
  });

  it('is idempotent: erasing an already-erased pass still answers 200', async () => {
    const passId = await enrollWithPii();
    await del(passId, ownerToken).expect(200);
    await del(passId, ownerToken).expect(200);
    const [pass] = await sql`select email from passes where id = ${passId}`;
    expect(pass!.email).toBeNull();
  });
});
