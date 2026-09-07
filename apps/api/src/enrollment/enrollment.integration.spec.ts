import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CafePublicInfo, EnrollResponse } from '@stamp/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
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

describe('enrollment (integration)', () => {
  let app: INestApplication;
  let sql: Sql;
  // Unique slugs per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slug = `cafe-enroll-${run}`;
  const disabledSlug = `cafe-off-${run}`;
  let cafeId: string;
  let disabledCafeId: string;

  // The enroll route is throttled per client IP. Give every test its own IP
  // (via X-Forwarded-For + trust proxy) so tests never eat each other's quota
  // and repeated runs stay deterministic.
  let nextIp = 0;
  function uniqueIp(): string {
    nextIp += 1;
    return `10.99.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Respect X-Forwarded-For so each test can present a distinct client IP
    // to the throttler.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug, brand_color, stamps_required)
      values ('Café Enroll', ${slug}, '#aa5500', 8) returning id`;
    [{ id: disabledCafeId }] = await sql`
      insert into cafes (name, slug, status)
      values ('Café Off', ${disabledSlug}, 'disabled') returning id`;
  });

  afterAll(async () => {
    await sql`delete from events where cafe_id in (${cafeId}, ${disabledCafeId})`;
    await sql`delete from passes where cafe_id in (${cafeId}, ${disabledCafeId})`;
    await sql`delete from cafes where id in (${cafeId}, ${disabledCafeId})`;
    await app.close();
    await sql.end();
  });

  function enroll(targetSlug: string, body: unknown) {
    return request(app.getHttpServer())
      .post(`/c/${targetSlug}/enroll`)
      .set('X-Forwarded-For', uniqueIp())
      .send(body as object);
  }

  describe('GET /c/:slug', () => {
    it('returns the public cafe info for an active cafe', async () => {
      const res = await request(app.getHttpServer()).get(`/c/${slug}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        name: 'Café Enroll',
        brandColor: '#aa5500',
        stampsRequired: 8,
      } satisfies CafePublicInfo);
    });

    it('returns 404 for an unknown cafe', async () => {
      const res = await request(app.getHttpServer()).get(`/c/nope-${run}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for a disabled cafe', async () => {
      const res = await request(app.getHttpServer()).get(`/c/${disabledSlug}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /c/:slug/enroll', () => {
    it('enrolls without email: pass created, enroll event written', async () => {
      const res = await enroll(slug, { platform: 'apple' });
      expect(res.status).toBe(201);
      const body = res.body as EnrollResponse;
      expect(body.passId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.addToWalletUrl).toBe(`/wallet/apple/${body.passId}`);

      const [pass] = await sql`select * from passes where id = ${body.passId}`;
      expect(pass).toMatchObject({ cafeId, platform: 'apple', stamps: 0 });
      expect(pass!.email).toBeNull();
      expect(pass!.marketingConsentAt).toBeNull();

      const events = await sql`
        select * from events where pass_id = ${body.passId} and action = 'enroll'`;
      expect(events).toHaveLength(1);
      expect(events[0]!.cafeId).toBe(cafeId);
    });

    it('enrolls with email but no explicit consent: email stored, no consent timestamp', async () => {
      const res = await enroll(slug, { platform: 'google', email: 'no-consent@example.com' });
      expect(res.status).toBe(201);
      expect(res.body.addToWalletUrl).toBe(`/wallet/google/${res.body.passId}`);

      const [pass] = await sql`select * from passes where id = ${res.body.passId}`;
      expect(pass!.email).toBe('no-consent@example.com');
      expect(pass!.marketingConsentAt).toBeNull();
    });

    it('sets the consent timestamp only on explicit marketingConsent === true', async () => {
      const res = await enroll(slug, {
        platform: 'google',
        email: 'consent@example.com',
        marketingConsent: true,
      });
      expect(res.status).toBe(201);

      const [pass] = await sql`select * from passes where id = ${res.body.passId}`;
      expect(pass!.marketingConsentAt).toBeInstanceOf(Date);
    });

    it('does not set the consent timestamp on marketingConsent === false', async () => {
      const res = await enroll(slug, {
        platform: 'apple',
        email: 'refused@example.com',
        marketingConsent: false,
      });
      expect(res.status).toBe(201);

      const [pass] = await sql`select * from passes where id = ${res.body.passId}`;
      expect(pass!.marketingConsentAt).toBeNull();
    });

    it('rejects an invalid body with 400 (bad platform, bad email, truthy non-boolean consent)', async () => {
      for (const body of [
        {},
        { platform: 'windows' },
        { platform: 'apple', email: 'not-an-email' },
        { platform: 'apple', marketingConsent: 'yes' },
      ]) {
        const res = await enroll(slug, body);
        expect(res.status).toBe(400);
      }
      const count = await sql`select count(*)::int as n from passes where cafe_id = ${cafeId}`;
      expect(count[0]!.n).toBeLessThan(10); // no pass rows created by rejected bodies
    });

    it('returns 404 when enrolling into an unknown cafe', async () => {
      const res = await enroll(`nope-${run}`, { platform: 'apple' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when enrolling into a disabled cafe', async () => {
      const res = await enroll(disabledSlug, { platform: 'apple' });
      expect(res.status).toBe(404);
      const passes = await sql`select * from passes where cafe_id = ${disabledCafeId}`;
      expect(passes).toHaveLength(0);
    });

    it('rate-limits enroll at 10/min per IP (11th request from one IP → 429)', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 10; i++) {
        const res = await request(app.getHttpServer())
          .post(`/c/${slug}/enroll`)
          .set('X-Forwarded-For', ip)
          .send({ platform: 'apple' });
        expect(res.status).toBe(201);
      }
      const res = await request(app.getHttpServer())
        .post(`/c/${slug}/enroll`)
        .set('X-Forwarded-For', ip)
        .send({ platform: 'apple' });
      expect(res.status).toBe(429);
    });

    it('does not rate-limit the public cafe info route', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 12; i++) {
        const res = await request(app.getHttpServer())
          .get(`/c/${slug}`)
          .set('X-Forwarded-For', ip);
        expect(res.status).toBe(200);
      }
    });
  });
});
