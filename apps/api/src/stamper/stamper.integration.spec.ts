import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { encodeQrPayload } from '@stamp/core';
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

describe('stamper endpoints (integration)', () => {
  let app: INestApplication;
  let sql: Sql;
  // Unique slugs per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slugA = `stamper-a-${run}`;
  const slugB = `stamper-b-${run}`;
  let cafeAId: string;
  let cafeBId: string;
  let baristaId: string;
  let tokenA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeAId }] = await sql`
      insert into cafes (name, slug, stamps_required, voucher_expiry_days)
      values ('Stamper A', ${slugA}, 10, 30) returning id`;
    [{ id: cafeBId }] = await sql`
      insert into cafes (name, slug) values ('Stamper B', ${slugB}) returning id`;
    [{ id: baristaId }] = await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeAId}, 'bea', 'barista', ${await hashPin('1234')}) returning id`;

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ cafeSlug: slugA, staffName: 'bea', pin: '1234' });
    expect(res.status).toBe(201);
    tokenA = res.body.token as string;
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

  // "Enrollment" for these tests is a raw SQL insert (T3 owns the real endpoint).
  async function enrollPass(cafeId: string): Promise<string> {
    const [{ id }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'apple') returning id`;
    return id as string;
  }

  function signedPayload(passId: string): string {
    return encodeQrPayload(passId, process.env.QR_SIGNING_SECRET!);
  }

  function post(path: string, body: unknown, token = tokenA) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  }

  describe('POST /stamper/scan', () => {
    it('rejects an unsigned payload with bad_signature', async () => {
      const res = await post('/stamper/scan', { qrPayload: 'garbage-no-signature' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ valid: false, reason: 'bad_signature' });
    });

    it('rejects a signed but unknown pass id with unknown_pass', async () => {
      const res = await post('/stamper/scan', { qrPayload: signedPayload(randomUUID()) });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ valid: false, reason: 'unknown_pass' });
    });

    it('rejects a pass of another cafe with HTTP 403 wrong_cafe', async () => {
      const passB = await enrollPass(cafeBId);
      const res = await post('/stamper/scan', { qrPayload: signedPayload(passB) });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('wrong_cafe');
    });

    it('returns the pass summary for a fresh same-cafe pass', async () => {
      const passA = await enrollPass(cafeAId);
      const res = await post('/stamper/scan', { qrPayload: signedPayload(passA) });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        valid: true,
        duplicateScanWarning: false,
        pass: {
          passId: passA,
          stamps: 0,
          stampsRequired: 10,
          vouchersAvailable: 0,
          lastStampAt: null,
        },
      });
    });

    it('warns about a duplicate scan right after a stamp', async () => {
      const passA = await enrollPass(cafeAId);
      // Simulate a stamp moments ago via the audit log (scan reads last stamp from events).
      await sql`
        insert into events (cafe_id, staff_id, pass_id, action, detail)
        values (${cafeAId}, ${baristaId}, ${passA}, 'stamp', ${sql.json({ count: 1 })})`;
      const res = await post('/stamper/scan', { qrPayload: signedPayload(passA) });
      expect(res.status).toBe(201);
      expect(res.body.valid).toBe(true);
      expect(res.body.duplicateScanWarning).toBe(true);
      expect(res.body.pass.lastStampAt).toEqual(expect.any(String));
    });
  });
});
