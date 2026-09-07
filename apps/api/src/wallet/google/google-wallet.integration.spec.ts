import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decodeQrPayload } from '@stamp/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { SQL } from '../../db/db.provider.js';
import type { Sql } from '../../db/db.provider.js';
import {
  GOOGLE_WALLET_CLIENT,
  GOOGLE_WALLET_CONFIG,
} from './google-wallet-client.js';
import type {
  GoogleWalletClient,
  LoyaltyClassPayload,
  LoyaltyObjectPayload,
  SaveJwtClaims,
} from './google-wallet-client.js';
import { GoogleWalletPush } from './google-wallet.push.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

const ISSUER_ID = '3388000000012345678';

/** In-memory GoogleWalletClient — the tests never talk to Google. */
class FakeGoogleWalletClient implements GoogleWalletClient {
  classes = new Map<string, LoyaltyClassPayload>();
  objects = new Map<string, LoyaltyObjectPayload>();
  insertClassCalls = 0;
  getClassCalls = 0;
  patches: Array<{ objectId: string; patch: Partial<LoyaltyObjectPayload> }> = [];

  async getClass(classId: string): Promise<LoyaltyClassPayload | null> {
    this.getClassCalls += 1;
    return this.classes.get(classId) ?? null;
  }

  async insertClass(cls: LoyaltyClassPayload): Promise<void> {
    this.insertClassCalls += 1;
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
    // Mirrors the real API: PATCHing a never-inserted object fails.
    if (!existing) throw new Error('google wallet api PATCH -> 404');
    this.patches.push({ objectId, patch });
    this.objects.set(objectId, { ...existing, ...patch });
  }

  async signSaveJwt(claims: SaveJwtClaims): Promise<string> {
    // Deterministic fake "jwt" the assertions can decode.
    return `fake.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  }
}

function decodeFakeJwt(jwt: string): SaveJwtClaims {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as SaveJwtClaims;
}

describe('google wallet (integration, client mocked)', () => {
  let app: INestApplication;
  let sql: Sql;
  let fake: FakeGoogleWalletClient;
  // Unique slug per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slug = `gwallet-${run}`;
  let cafeId: string;
  let googlePassId: string;
  let applePassId: string;

  beforeAll(async () => {
    fake = new FakeGoogleWalletClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_WALLET_CONFIG)
      .useValue({ issuerId: ISSUER_ID, credentialsPath: '/unused-in-tests.json' })
      .overrideProvider(GOOGLE_WALLET_CLIENT)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug, brand_color, stamps_required)
      values ('Google Café', ${slug}, '#aa3366', 10) returning id`;
    [{ id: googlePassId }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'google') returning id`;
    [{ id: applePassId }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'apple') returning id`;
  });

  afterAll(async () => {
    await sql`delete from vouchers where pass_id in
      (select id from passes where cafe_id = ${cafeId})`;
    await sql`delete from passes where cafe_id = ${cafeId}`;
    await sql`delete from cafes where id = ${cafeId}`;
    await app.close();
    await sql.end();
  });

  const objectId = (passId: string) => `${ISSUER_ID}.pass_${passId}`;
  const classId = () => `${ISSUER_ID}.cafe_${cafeId}`;

  function getSaveLink(passId: string) {
    return request(app.getHttpServer()).get(`/wallet/google/${passId}`);
  }

  describe('GET /wallet/google/:passId', () => {
    it('302-redirects to the signed save link referencing class and object', async () => {
      const res = await getSaveLink(googlePassId);
      expect(res.status).toBe(302);
      const location = res.headers.location!;
      expect(location).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
      const claims = decodeFakeJwt(location.slice('https://pay.google.com/gp/v/save/'.length));
      expect(claims).toEqual({
        payload: {
          loyaltyObjects: [{ id: objectId(googlePassId), classId: classId() }],
        },
        origins: [],
      });
    });

    it('created the LoyaltyClass lazily with the café branding', () => {
      expect(fake.insertClassCalls).toBe(1);
      expect(fake.classes.get(classId())).toEqual({
        id: classId(),
        issuerName: 'Google Café',
        programName: 'Google Café Stamp Card',
        reviewStatus: 'UNDER_REVIEW',
        hexBackgroundColor: '#aa3366',
      });
    });

    it('created one LoyaltyObject with stamps in loyaltyPoints, voucher text module and signed QR', () => {
      const obj = fake.objects.get(objectId(googlePassId))!;
      expect(obj).toBeDefined();
      expect(obj.classId).toBe(classId());
      expect(obj.state).toBe('ACTIVE');
      expect(obj.loyaltyPoints).toEqual({ label: 'Stamps', balance: { string: '0 / 10' } });
      expect(obj.textModulesData).toEqual([
        { id: 'vouchers', header: 'Vouchers', body: 'Collect all stamps to earn a free drink.' },
      ]);
      expect(obj.barcode.type).toBe('QR_CODE');
      // The QR carries the same signed payload the stamper API verifies.
      expect(decodeQrPayload(obj.barcode.value, process.env.QR_SIGNING_SECRET!)).toBe(
        googlePassId,
      );
    });

    it('does not create the class again for a second pass of the same café', async () => {
      const [{ id: secondPass }] = await sql`
        insert into passes (cafe_id, platform) values (${cafeId}, 'google') returning id`;
      const res = await getSaveLink(secondPass);
      expect(res.status).toBe(302);
      expect(fake.insertClassCalls).toBe(1);
      expect(fake.objects.has(objectId(secondPass))).toBe(true);
    });

    it('re-requesting a save link refreshes the existing object instead of duplicating it', async () => {
      await sql`update passes set stamps = 3 where id = ${googlePassId}`;
      const res = await getSaveLink(googlePassId);
      expect(res.status).toBe(302);
      const obj = fake.objects.get(objectId(googlePassId))!;
      expect(obj.loyaltyPoints.balance.string).toBe('3 / 10');
      expect(fake.patches.at(-1)!.objectId).toBe(objectId(googlePassId));
    });

    it('404s for an unknown pass id', async () => {
      const res = await getSaveLink(randomUUID());
      expect(res.status).toBe(404);
    });

    it('400s for a non-uuid pass id', async () => {
      const res = await getSaveLink('not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('400s for an apple-platform pass', async () => {
      const res = await getSaveLink(applePassId);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('not_a_google_pass');
    });
  });

  describe('GoogleWalletPush (WalletPushPort)', () => {
    it('passChanged PATCHes the loyalty object with the new stamp and voucher state', async () => {
      await sql`update passes set stamps = 7 where id = ${googlePassId}`;
      await sql`insert into vouchers (pass_id) values (${googlePassId})`;
      const push = app.get(GoogleWalletPush);
      await push.passChanged(googlePassId);
      const last = fake.patches.at(-1)!;
      expect(last.objectId).toBe(objectId(googlePassId));
      expect(last.patch.loyaltyPoints).toEqual({
        label: 'Stamps',
        balance: { string: '7 / 10' },
      });
      expect(last.patch.textModulesData).toEqual([
        {
          id: 'vouchers',
          header: 'Vouchers',
          body: '1 free drink ready — show this pass at the counter.',
        },
      ]);
    });

    it('no-ops for apple passes and unknown passes', async () => {
      const before = fake.patches.length;
      const push = app.get(GoogleWalletPush);
      await push.passChanged(applePassId);
      await push.passChanged(randomUUID());
      expect(fake.patches.length).toBe(before);
    });

    it('swallows push failures (e.g. pass never saved to a wallet) so stamping never breaks', async () => {
      const [{ id: unsavedPass }] = await sql`
        insert into passes (cafe_id, platform) values (${cafeId}, 'google') returning id`;
      const push = app.get(GoogleWalletPush);
      // No loyalty object exists for this pass; the fake's PATCH throws.
      await expect(push.passChanged(unsavedPass)).resolves.toBeUndefined();
    });
  });
});
