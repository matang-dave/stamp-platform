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
import { APNS_CLIENT } from '../wallet/apple/apns.client.js';
import type { ApnsClient } from '../wallet/apple/apns.client.js';
import {
  GOOGLE_WALLET_CLIENT,
  GOOGLE_WALLET_CONFIG,
} from '../wallet/google/google-wallet-client.js';
import type {
  GoogleWalletClient,
  LoyaltyClassPayload,
  LoyaltyObjectPayload,
  SaveJwtClaims,
} from '../wallet/google/google-wallet-client.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

const ISSUER_ID = '3388000000019999999';

/** In-memory GoogleWalletClient (same pattern as the T8 integration spec). */
class FakeGoogleWalletClient implements GoogleWalletClient {
  classes = new Map<string, LoyaltyClassPayload>();
  objects = new Map<string, LoyaltyObjectPayload>();
  patches: Array<{ objectId: string; patch: Partial<LoyaltyObjectPayload> }> = [];

  async getClass(classId: string): Promise<LoyaltyClassPayload | null> {
    return this.classes.get(classId) ?? null;
  }
  async insertClass(cls: LoyaltyClassPayload): Promise<void> {
    this.classes.set(cls.id, cls);
  }
  async getObject(objectId: string): Promise<LoyaltyObjectPayload | null> {
    return this.objects.get(objectId) ?? null;
  }
  async insertObject(obj: LoyaltyObjectPayload): Promise<void> {
    this.objects.set(obj.id, obj);
  }
  async patchObject(objectId: string, patch: Partial<LoyaltyObjectPayload>): Promise<void> {
    const existing = this.objects.get(objectId);
    if (!existing) throw new Error('google wallet api PATCH -> 404');
    this.patches.push({ objectId, patch });
    this.objects.set(objectId, { ...existing, ...patch });
  }
  async signSaveJwt(claims: SaveJwtClaims): Promise<string> {
    return `fake.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  }
}

/** Records APNs pushes instead of talking to Apple. */
class FakeApnsClient implements ApnsClient {
  pushes: Array<{ pushToken: string; topic: string }> = [];
  async pushPassUpdate(pushToken: string, topic: string): Promise<void> {
    this.pushes.push({ pushToken, topic });
  }
}

describe('owner endpoints (integration)', () => {
  let app: INestApplication;
  let sql: Sql;
  let google: FakeGoogleWalletClient;
  let apns: FakeApnsClient;
  // Unique slugs per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slugA = `owner-a-${run}`;
  const slugB = `owner-b-${run}`;
  let cafeAId: string;
  let cafeBId: string;
  let ownerAId: string;
  let baristaAId: string;
  let ownerToken: string;
  let baristaToken: string;
  let ownerBToken: string;
  let googlePassA: string;
  let applePassA: string;

  beforeAll(async () => {
    google = new FakeGoogleWalletClient();
    apns = new FakeApnsClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_WALLET_CONFIG)
      .useValue({ issuerId: ISSUER_ID, credentialsPath: '/unused-in-tests.json' })
      .overrideProvider(GOOGLE_WALLET_CLIENT)
      .useValue(google)
      .overrideProvider(APNS_CLIENT)
      .useValue(apns)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeAId }] = await sql`
      insert into cafes (name, slug, stamps_required) values ('Owner A', ${slugA}, 10) returning id`;
    [{ id: cafeBId }] = await sql`
      insert into cafes (name, slug) values ('Owner B', ${slugB}) returning id`;
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

    // One Google and one Apple pass in café A.
    [{ id: googlePassA }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeAId}, 'google') returning id`;
    [{ id: applePassA }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeAId}, 'apple') returning id`;
    // The Google object exists upstream (customer saved the pass once).
    await request(app.getHttpServer()).get(`/wallet/google/${googlePassA}`).expect(302);
    // The Apple pass is registered on one device.
    await sql`
      insert into wallet_registrations (pass_id, platform, device_id, push_token)
      values (${applePassA}, 'apple', 'device-1', 'push-token-1')`;
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

  function withToken(req: request.Test, token: string) {
    return req.set('Authorization', `Bearer ${token}`);
  }

  describe('auth & role guard', () => {
    it('rejects requests without a token with 401', async () => {
      await request(app.getHttpServer()).get('/owner/stats').expect(401);
      await request(app.getHttpServer()).post('/owner/broadcast').send({ message: 'x' }).expect(401);
      await request(app.getHttpServer()).post('/owner/staff').send({ name: 'x' }).expect(401);
    });

    it('rejects baristas on every owner route with 403', async () => {
      const server = app.getHttpServer();
      await withToken(request(server).get('/owner/stats'), baristaToken).expect(403);
      await withToken(request(server).get('/owner/staff'), baristaToken).expect(403);
      await withToken(request(server).post('/owner/broadcast'), baristaToken)
        .send({ message: 'hi' })
        .expect(403);
      await withToken(request(server).post('/owner/staff'), baristaToken)
        .send({ name: 'mallory' })
        .expect(403);
      await withToken(request(server).delete(`/owner/staff/${baristaAId}`), baristaToken).expect(
        403,
      );
    });
  });

  describe('GET /owner/stats', () => {
    it('returns the three aggregates scoped to the session café', async () => {
      // Café A activity: stamps this week (1 + bulk 5), one older than a week
      // (must not count), one redeemed + one open voucher.
      const [{ id: statsPass }] = await sql`
        insert into passes (cafe_id, platform) values (${cafeAId}, 'apple') returning id`;
      await sql`
        insert into events (cafe_id, staff_id, pass_id, action, detail) values
        (${cafeAId}, ${baristaAId}, ${statsPass}, 'stamp', ${sql.json({ count: 1 })}),
        (${cafeAId}, ${baristaAId}, ${statsPass}, 'stamp_bulk', ${sql.json({ count: 5, migration: true })})`;
      await sql`
        insert into events (cafe_id, staff_id, pass_id, action, detail, created_at)
        values (${cafeAId}, ${baristaAId}, ${statsPass}, 'stamp', ${sql.json({ count: 1 })},
                now() - interval '8 days')`;
      await sql`
        insert into vouchers (pass_id, redeemed_at, redeemed_by)
        values (${statsPass}, now(), ${baristaAId})`;
      await sql`insert into vouchers (pass_id) values (${statsPass})`;

      const res = await withToken(request(app.getHttpServer()).get('/owner/stats'), ownerToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        passesIssued: 3, // googlePassA, applePassA, statsPass
        stampsThisWeek: 6, // 1 + 5, the 8-day-old stamp excluded
        vouchersRedeemed: 1,
      });
    });

    it('is isolated per café: café B sees only its own (empty) numbers', async () => {
      const res = await withToken(request(app.getHttpServer()).get('/owner/stats'), ownerBToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ passesIssued: 0, stampsThisWeek: 0, vouchersRedeemed: 0 });
    });
  });

  describe('POST /owner/broadcast', () => {
    it('rejects an empty message and one over 140 chars with 400', async () => {
      const server = app.getHttpServer();
      await withToken(request(server).post('/owner/broadcast'), ownerToken)
        .send({ message: '' })
        .expect(400);
      await withToken(request(server).post('/owner/broadcast'), ownerToken)
        .send({ message: 'x'.repeat(141) })
        .expect(400);
      const events = await sql`
        select id from events where cafe_id = ${cafeAId} and action = 'broadcast'`;
      expect(events).toHaveLength(0);
    });

    it('audits the broadcast, patches Google objects and pushes to Apple devices', async () => {
      const message = 'Free cookie with every coffee today!';
      const res = await withToken(request(app.getHttpServer()).post('/owner/broadcast'), ownerToken)
        .send({ message });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ sent: true, recipients: expect.any(Number) });

      // Audit event with the owner's identity and the message.
      const events = await sql`
        select staff_id, pass_id, detail from events
        where cafe_id = ${cafeAId} and action = 'broadcast'`;
      expect(events).toEqual([
        expect.objectContaining({ staffId: ownerAId, passId: null, detail: { message } }),
      ]);

      // Google: message patched onto the café's saved loyalty object.
      const patch = google.patches.find(
        (p) => p.objectId === `${ISSUER_ID}.pass_${googlePassA}` && p.patch.messages,
      );
      expect(patch).toBeDefined();
      expect(patch!.patch.messages).toEqual([
        { id: 'broadcast', header: 'Owner A', body: message },
      ]);

      // Apple: every registered device of the café got a push.
      expect(apns.pushes).toContainEqual(
        expect.objectContaining({ pushToken: 'push-token-1' }),
      );
    });

    it('survives Google objects that were never saved to a wallet', async () => {
      // A google pass with no upstream object: the fake's PATCH throws, the
      // broadcast must still succeed (graceful no-credential/no-object path).
      await sql`insert into passes (cafe_id, platform) values (${cafeAId}, 'google')`;
      const res = await withToken(request(app.getHttpServer()).post('/owner/broadcast'), ownerToken)
        .send({ message: 'second broadcast' });
      expect(res.status).toBe(201);
      expect(res.body.sent).toBe(true);
    });
  });

  describe('staff CRUD', () => {
    it('GET /owner/staff lists only this café’s staff', async () => {
      const res = await withToken(request(app.getHttpServer()).get('/owner/staff'), ownerToken);
      expect(res.status).toBe(200);
      const names = (res.body as Array<{ name: string }>).map((s) => s.name);
      expect(names).toContain('olivia');
      expect(names).toContain('bea');
      expect(names).not.toContain('otto');
      for (const member of res.body as Array<Record<string, unknown>>) {
        expect(member).toEqual({
          staffId: expect.any(String),
          name: expect.any(String),
          role: expect.stringMatching(/^(owner|barista)$/),
          status: expect.stringMatching(/^(active|disabled)$/),
          createdAt: expect.any(String),
        });
      }
    });

    it('POST /owner/staff creates a barista whose generated PIN can log in', async () => {
      const res = await withToken(request(app.getHttpServer()).post('/owner/staff'), ownerToken)
        .send({ name: 'nino' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        staffId: expect.any(String),
        name: 'nino',
        role: 'barista',
        pin: expect.stringMatching(/^\d{4}$/),
      });

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ cafeSlug: slugA, staffName: 'nino', pin: res.body.pin });
      expect(loginRes.status).toBe(201);
      expect(loginRes.body.role).toBe('barista');
      expect(loginRes.body.cafeId).toBe(cafeAId);
    });

    it('POST /owner/staff rejects a missing/blank name with 400', async () => {
      await withToken(request(app.getHttpServer()).post('/owner/staff'), ownerToken)
        .send({})
        .expect(400);
      await withToken(request(app.getHttpServer()).post('/owner/staff'), ownerToken)
        .send({ name: '   ' })
        .expect(400);
    });

    it('DELETE /owner/staff/:id soft-disables: row is kept, login stops working', async () => {
      const created = await withToken(request(app.getHttpServer()).post('/owner/staff'), ownerToken)
        .send({ name: 'temp' });
      const { staffId, pin } = created.body as { staffId: string; pin: string };

      const res = await withToken(
        request(app.getHttpServer()).delete(`/owner/staff/${staffId}`),
        ownerToken,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ disabled: true });

      // Soft delete: the row (and its audit references) survive.
      const [row] = await sql`select status from staff where id = ${staffId}`;
      expect(row!.status).toBe('disabled');

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ cafeSlug: slugA, staffName: 'temp', pin })
        .expect(401);
    });

    it('cannot manage staff of another café (404, nothing changes)', async () => {
      await withToken(
        request(app.getHttpServer()).delete(`/owner/staff/${baristaAId}`),
        ownerBToken,
      ).expect(404);
      const [row] = await sql`select status from staff where id = ${baristaAId}`;
      expect(row!.status).toBe('active');
    });

    it('an owner cannot disable their own account', async () => {
      await withToken(
        request(app.getHttpServer()).delete(`/owner/staff/${ownerAId}`),
        ownerToken,
      ).expect(400);
    });

    it('rejects a non-uuid staff id with 404', async () => {
      await withToken(
        request(app.getHttpServer()).delete('/owner/staff/not-a-uuid'),
        ownerToken,
      ).expect(404);
    });
  });

  describe('broadcast on the Apple pass (T10 additive extension)', () => {
    it('the latest broadcast becomes a lock-screen-notifying back field of the .pkpass json', async () => {
      // buildPassJson is pure; this covers the latestMessage plumbing without
      // needing a configured Apple signer.
      const { buildPassJson } = await import('../wallet/apple/pass-json.js');
      const base = {
        passId: applePassA,
        cafe: {
          id: cafeAId,
          name: 'Owner A',
          slug: slugA,
          brandColor: '#123456',
          logoUrl: null,
          stampsRequired: 10,
          status: 'active' as const,
        },
        summary: {
          passId: applePassA,
          stamps: 2,
          stampsRequired: 10,
          vouchersAvailable: 0,
          lastStampAt: null,
        },
        authenticationToken: 'a'.repeat(32),
        teamId: 'TEAM123456',
        passTypeId: 'pass.test.stamp',
        webServiceUrl: 'https://api.example.com/passkit',
        qrSigningSecret: process.env.QR_SIGNING_SECRET!,
      };
      expect(buildPassJson(base).storeCard.backFields).toBeUndefined();
      expect(
        buildPassJson({ ...base, latestMessage: 'Free cookie today!' }).storeCard.backFields,
      ).toEqual([
        { key: 'broadcast', label: 'Owner A', value: 'Free cookie today!', changeMessage: '%@' },
      ]);
    });

    it('a broadcast marks the café’s registered Apple passes as updatable (PassKit web service)', async () => {
      // apns.pushes proves the push went out; here the device follow-up call
      // must report the pass serial as changed since before the broadcast.
      const before = Date.now() - 60_000;
      const res = await request(app.getHttpServer()).get(
        `/passkit/v1/devices/device-1/registrations/pass.test.stamp?passesUpdatedSince=${before}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.serialNumbers).toContain(applePassA);
    });
  });
});
