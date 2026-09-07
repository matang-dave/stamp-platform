// The docs/mvp-plan.md acceptance test, fully automated except the two
// on-phone wallet smoke tests (docs/wallet-google-smoke-test.md,
// docs/wallet-apple-smoke-test.md):
//
//   Two cafés exist and can't see each other's data. A customer goes from
//   counter QR → pass (enroll endpoint); a logged-in barista stamps them and
//   the audit log names that barista; at the café's configured stamp count
//   (café B is configured to 6) a voucher appears; any barista of that café
//   redeems it (oldest voucher first); the owner sends a broadcast, manages
//   staff and sees stats; the GDPR deletion path erases PII via API and CLI.
//
// Runs against the real AppModule with NO wallet credentials — the broadcast
// and wallet pushes must no-op gracefully.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { encodeQrPayload } from '@stamp/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { hashPin } from '../src/auth/pin.js';
import { SQL } from '../src/db/db.provider.js';
import type { Sql } from '../src/db/db.provider.js';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

describe('MVP acceptance (e2e, two cafés)', () => {
  let app: INestApplication;
  let sql: Sql;
  // Unique slugs per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slugA = `accept-a-${run}`;
  const slugB = `accept-b-${run}`;
  const emailB = `accept-b-${run}@example.com`;
  let cafeAId: string;
  let cafeBId: string;
  let baristaAId: string;
  let baristaAToken: string;
  let baristaBToken: string;
  let ownerAToken: string;
  let ownerBToken: string;
  let passA: string; // café A customer (google, email + consent)
  let passB: string; // café B customer (apple, email, NO consent)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    // Platform admin creates the two tenants (CLI/SQL is the MVP admin).
    [{ id: cafeAId }] = await sql`
      insert into cafes (name, slug, brand_color, stamps_required, voucher_expiry_days)
      values ('Café Kranz', ${slugA}, '#6f4e37', 10, 30) returning id`;
    // Café B runs a shorter program: voucher at 6 stamps.
    [{ id: cafeBId }] = await sql`
      insert into cafes (name, slug, brand_color, stamps_required)
      values ('Bohnenstube', ${slugB}, '#204060', 6) returning id`;
    await sql`
      insert into staff (cafe_id, name, role, pin_hash) values
      (${cafeAId}, 'olga', 'owner', ${await hashPin('1001')}),
      (${cafeBId}, 'oskar', 'owner', ${await hashPin('2002')}),
      (${cafeBId}, 'ben', 'barista', ${await hashPin('4004')})`;
    [{ id: baristaAId }] = await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeAId}, 'anna', 'barista', ${await hashPin('3003')}) returning id`;

    ownerAToken = await login(slugA, 'olga', '1001');
    ownerBToken = await login(slugB, 'oskar', '2002');
    baristaAToken = await login(slugA, 'anna', '3003');
    baristaBToken = await login(slugB, 'ben', '4004');
  });

  afterAll(async () => {
    await sql`delete from wallet_registrations where pass_id in
      (select id from passes where cafe_id in (${cafeAId}, ${cafeBId}))`;
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

  function qr(passId: string): string {
    return encodeQrPayload(passId, process.env.QR_SIGNING_SECRET!);
  }

  function post(path: string, body: unknown, token: string) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  }

  describe('enrollment (counter QR → pass)', () => {
    it('serves each café’s public enrollment info; unknown cafés 404', async () => {
      const a = await request(app.getHttpServer()).get(`/c/${slugA}`);
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ name: 'Café Kranz', brandColor: '#6f4e37', stampsRequired: 10 });
      const b = await request(app.getHttpServer()).get(`/c/${slugB}`);
      expect(b.body).toEqual({ name: 'Bohnenstube', brandColor: '#204060', stampsRequired: 6 });
      await request(app.getHttpServer()).get('/c/no-such-cafe').expect(404);
    });

    it('enrolls with email + explicit consent (café A, google)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/c/${slugA}/enroll`)
        .send({ platform: 'google', email: 'anna.kunde@example.com', marketingConsent: true });
      expect(res.status).toBe(201);
      passA = res.body.passId as string;
      expect(res.body.addToWalletUrl).toBe(`/wallet/google/${passA}`);
      const [row] = await sql`
        select email, marketing_consent_at from passes where id = ${passA}`;
      expect(row!.email).toBe('anna.kunde@example.com');
      expect(row!.marketingConsentAt).toBeInstanceOf(Date);
    });

    it('enrolls with email but WITHOUT consent (café B, apple): no consent timestamp', async () => {
      const res = await request(app.getHttpServer())
        .post(`/c/${slugB}/enroll`)
        .send({ platform: 'apple', email: emailB });
      expect(res.status).toBe(201);
      passB = res.body.passId as string;
      expect(res.body.addToWalletUrl).toBe(`/wallet/apple/${passB}`);
      const [row] = await sql`
        select email, marketing_consent_at from passes where id = ${passB}`;
      expect(row!.email).toBe(emailB);
      expect(row!.marketingConsentAt).toBeNull();
    });
  });

  describe('café A happy path (default 10-stamp program)', () => {
    it('scan → 10 stamps → voucher → redeem, audit log names the barista', async () => {
      const scan = await post('/stamper/scan', { qrPayload: qr(passA) }, baristaAToken);
      expect(scan.status).toBe(201);
      expect(scan.body).toMatchObject({
        valid: true,
        duplicateScanWarning: false,
        pass: { passId: passA, stamps: 0, stampsRequired: 10, vouchersAvailable: 0 },
      });

      for (let i = 1; i <= 10; i++) {
        const res = await post('/stamper/stamp', { passId: passA }, baristaAToken);
        expect(res.status).toBe(201);
        expect(res.body.pass.stamps).toBe(i % 10);
        expect(res.body.vouchersEarned).toBe(i === 10 ? 1 : 0);
      }

      // The voucher appears on the next scan (with a duplicate-scan warning).
      const rescan = await post('/stamper/scan', { qrPayload: qr(passA) }, baristaAToken);
      expect(rescan.body.pass).toMatchObject({ stamps: 0, vouchersAvailable: 1 });
      expect(rescan.body.duplicateScanWarning).toBe(true);

      // Voucher expiry came from café A's config (30 days), set at earn time.
      const [voucher] = await sql`select expires_at from vouchers where pass_id = ${passA}`;
      const days = ((voucher!.expiresAt as Date).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);

      const redeem = await post('/stamper/redeem', { passId: passA }, baristaAToken);
      expect(redeem.status).toBe(201);
      expect(redeem.body.redeemed).toBe(true);
      expect(redeem.body.pass).toMatchObject({ stamps: 0, vouchersAvailable: 0 });

      // Full per-pass audit trail; every counter action names the barista.
      const events = await sql`
        select staff_id, action from events where pass_id = ${passA} order by id`;
      expect(events.map((e) => e.action)).toEqual([
        'enroll',
        ...Array.from({ length: 10 }, () => 'stamp'),
        'voucher_earned',
        'voucher_redeemed',
      ]);
      expect(events.slice(1).every((e) => e.staffId === baristaAId)).toBe(true);
    });
  });

  describe('café B happy path (café-specific 6-stamp threshold)', () => {
    it('earns the voucher at 6 stamps, not 10', async () => {
      for (let i = 1; i <= 6; i++) {
        const res = await post('/stamper/stamp', { passId: passB }, baristaBToken);
        expect(res.status).toBe(201);
        expect(res.body.pass.stamps).toBe(i % 6);
        expect(res.body.vouchersEarned).toBe(i === 6 ? 1 : 0);
      }
      const scan = await post('/stamper/scan', { qrPayload: qr(passB) }, baristaBToken);
      expect(scan.body.pass).toMatchObject({
        stampsRequired: 6,
        stamps: 0,
        vouchersAvailable: 1,
      });
    });

    it('redeem consumes the OLDEST voucher first', async () => {
      // A second, older voucher (e.g. migrated) exists next to the earned one.
      const [{ id: older }] = await sql`
        insert into vouchers (pass_id, created_at)
        values (${passB}, now() - interval '2 days') returning id`;
      const res = await post('/stamper/redeem', { passId: passB }, baristaBToken);
      expect(res.status).toBe(201);
      expect(res.body.redeemed).toBe(true);
      expect(res.body.pass.vouchersAvailable).toBe(1);
      const rows = await sql`
        select id, redeemed_at from vouchers where pass_id = ${passB} order by created_at`;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).toBe(older);
      expect(rows[0]!.redeemedAt).toBeInstanceOf(Date);
      expect(rows[1]!.redeemedAt).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('a café A barista cannot scan, stamp or redeem a café B pass (403)', async () => {
      const scan = await post('/stamper/scan', { qrPayload: qr(passB) }, baristaAToken);
      expect(scan.status).toBe(403);
      expect(scan.body.message).toBe('wrong_cafe');
      await post('/stamper/stamp', { passId: passB }, baristaAToken).expect(403);
      await post('/stamper/redeem', { passId: passB }, baristaAToken).expect(403);
      // Nothing about café B changed.
      const [pass] = await sql`select stamps from passes where id = ${passB}`;
      expect(pass!.stamps).toBe(0);
    });

    it('owners only see their own café’s stats', async () => {
      const a = await request(app.getHttpServer())
        .get('/owner/stats')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ passesIssued: 1, stampsThisWeek: 10, vouchersRedeemed: 1 });

      const b = await request(app.getHttpServer())
        .get('/owner/stats')
        .set('Authorization', `Bearer ${ownerBToken}`);
      expect(b.body).toEqual({ passesIssued: 1, stampsThisWeek: 6, vouchersRedeemed: 1 });
    });
  });

  describe('owner mini-admin', () => {
    it('broadcast succeeds without any wallet credentials and is audited; baristas may not', async () => {
      const message = 'Doppelter Stempel-Samstag! Double-stamp Saturday!';
      const res = await post('/owner/broadcast', { message }, ownerAToken);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ sent: true, recipients: 1 });
      const [event] = await sql`
        select detail from events where cafe_id = ${cafeAId} and action = 'broadcast'`;
      expect(event!.detail).toEqual({ message });

      await post('/owner/broadcast', { message: 'x'.repeat(141) }, ownerAToken).expect(400);
      await post('/owner/broadcast', { message }, baristaAToken).expect(403);
    });

    it('creates a barista (generated PIN works once handed over) and disables them again', async () => {
      const created = await post('/owner/staff', { name: 'nadia' }, ownerAToken);
      expect(created.status).toBe(201);
      const { staffId, pin } = created.body as { staffId: string; pin: string };
      expect(pin).toMatch(/^\d{4}$/);

      // The new barista can work the counter...
      const nadiaToken = await login(slugA, 'nadia', pin);
      const stamp = await post('/stamper/stamp', { passId: passA }, nadiaToken);
      expect(stamp.status).toBe(201);

      // ...until the owner disables them (soft delete, audit history kept).
      await request(app.getHttpServer())
        .delete(`/owner/staff/${staffId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ cafeSlug: slugA, staffName: 'nadia', pin })
        .expect(401);
      const [event] = await sql`
        select staff_id from events
        where pass_id = ${passA} and action = 'stamp' and staff_id = ${staffId}`;
      expect(event).toBeDefined();
    });
  });

  describe('GDPR deletion path', () => {
    it('the owner erases a pass’s PII via the API; anonymized events survive', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/owner/pass/${passA}/pii`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ erased: true });
      const [pass] = await sql`
        select email, marketing_consent_at from passes where id = ${passA}`;
      expect(pass).toEqual({ email: null, marketingConsentAt: null });
      const [{ count }] = await sql`
        select count(*)::int as count from events where pass_id = ${passA}`;
      expect(count).toBeGreaterThanOrEqual(13); // enroll + counter history kept
    });

    it('the operator erases by email via scripts/delete-pass-data.ts', async () => {
      const { stdout } = await execFileAsync(
        'node_modules/.bin/tsx',
        ['scripts/delete-pass-data.ts', emailB],
        { cwd: repoRoot, env: process.env, timeout: 60_000 },
      );
      expect(stdout).toContain(`erased PII of pass ${passB}`);
      const [pass] = await sql`
        select email, marketing_consent_at from passes where id = ${passB}`;
      expect(pass).toEqual({ email: null, marketingConsentAt: null });
      const [event] = await sql`
        select detail from events where pass_id = ${passB} and action = 'pii_erased'`;
      expect(event!.detail).toEqual({ source: 'cli' });
    }, 60_000);
  });
});
