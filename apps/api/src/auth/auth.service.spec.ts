import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { hashPin, verifyPin } from './pin.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

describe('pin hashing (scrypt)', () => {
  it('round-trips a correct pin and rejects a wrong one', async () => {
    const hash = await hashPin('1234');
    expect(hash).not.toContain('1234');
    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('4321', hash)).toBe(false);
  });

  it('salts hashes so equal pins produce different hashes', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await verifyPin('1234', 'not-a-hash')).toBe(false);
  });
});

describe('auth + tenancy (integration)', () => {
  let app: INestApplication;
  let sql: Sql;
  // Unique slugs per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slugA = `cafe-a-${run}`;
  const slugB = `cafe-b-${run}`;
  let cafeAId: string;
  let cafeBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeAId }] = await sql`
      insert into cafes (name, slug) values ('Cafe A', ${slugA}) returning id`;
    [{ id: cafeBId }] = await sql`
      insert into cafes (name, slug) values ('Cafe B', ${slugB}) returning id`;
    await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeAId}, 'anna', 'barista', ${await hashPin('1234')})`;
  });

  afterAll(async () => {
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

  it('POST /auth/login returns a JWT session for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ cafeSlug: slugA, staffName: 'anna', pin: '1234' });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.cafeId).toBe(cafeAId);
    expect(res.body.role).toBe('barista');
    // JWT payload carries the session and a 12h expiry.
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1]!, 'base64url').toString());
    expect(payload).toMatchObject({ staffId: res.body.staffId, cafeId: cafeAId, role: 'barista' });
    expect(payload.exp - payload.iat).toBe(12 * 60 * 60);
  });

  it('POST /auth/login rejects a wrong pin with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ cafeSlug: slugA, staffName: 'anna', pin: '9999' });
    expect(res.status).toBe(401);
  });

  it('POST /auth/login rejects an unknown cafe or staff with 401', async () => {
    for (const body of [
      { cafeSlug: `nope-${run}`, staffName: 'anna', pin: '1234' },
      { cafeSlug: slugA, staffName: 'nobody', pin: '1234' },
    ]) {
      const res = await request(app.getHttpServer()).post('/auth/login').send(body);
      expect(res.status).toBe(401);
    }
  });
});
