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
import { APNS_CLIENT } from './apns.client.js';
import { ApplePassPush } from './apple-pass-push.js';
import { APPLE_SIGNER } from './apple-signer.js';
import type { AppleSigner } from './apple-signer.js';
import { AppleWalletConfig } from './apple-wallet.config.js';
import type { ApplePassJson } from './pass-json.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

const PASS_TYPE_ID = 'pass.com.example.stamp';

// All Apple credentials mocked: the fake signer records the pass.json it was
// asked to sign, the fake APNs client records pushes. No certificates needed.
const builtPassJsons: ApplePassJson[] = [];
const fakeSigner: AppleSigner = {
  async createPkpass(passJson) {
    builtPassJsons.push(passJson);
    return Buffer.from(`PKPASS:${passJson.serialNumber}`);
  },
};

const pushes: Array<{ pushToken: string; topic: string }> = [];
let failNextPush = false;
const fakeApns = {
  async pushPassUpdate(pushToken: string, topic: string) {
    if (failNextPush) {
      failNextPush = false;
      throw new Error('BadDeviceToken');
    }
    pushes.push({ pushToken, topic });
  },
};

describe('apple wallet (integration, signer + APNs mocked)', () => {
  let app: INestApplication;
  let sql: Sql;
  const run = randomUUID().slice(0, 8);
  const slug = `apple-${run}`;
  let cafeId: string;
  let applePassId: string;
  let googlePassId: string;
  let authToken: string;

  beforeAll(async () => {
    const configured = Object.create(AppleWalletConfig.prototype) as AppleWalletConfig;
    Object.assign(configured, {
      teamId: 'TEAM123456',
      passTypeId: PASS_TYPE_ID,
      certPath: '/nonexistent/pass.pem',
      certPassword: '',
      wwdrPath: '/nonexistent/wwdr.pem',
      webServiceUrl: 'https://api.example.com/passkit',
      qrSigningSecret: process.env.QR_SIGNING_SECRET!,
    });
    // The real getter checks cert files on disk; tests are "configured" by fiat.
    Object.defineProperty(configured, 'isConfigured', { get: () => true });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppleWalletConfig)
      .useValue(configured)
      .overrideProvider(APPLE_SIGNER)
      .useValue(fakeSigner)
      .overrideProvider(APNS_CLIENT)
      .useValue(fakeApns)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug, brand_color, stamps_required)
      values ('Apple Test Café', ${slug}, '#6f4e37', 10) returning id`;
    [{ id: applePassId }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'apple') returning id`;
    [{ id: googlePassId }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'google') returning id`;
  });

  afterAll(async () => {
    await sql`delete from wallet_registrations where pass_id in
      (select id from passes where cafe_id = ${cafeId})`;
    await sql`delete from events where cafe_id = ${cafeId}`;
    await sql`delete from passes where cafe_id = ${cafeId}`;
    await sql`delete from cafes where id = ${cafeId}`;
    await app.close();
    await sql.end();
  });

  const http = () => request(app.getHttpServer());

  // superagent has no parser for application/vnd.apple.pkpass; buffer it.
  const binaryParser = (res: NodeJS.ReadableStream, cb: (err: null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  describe('GET /wallet/apple/:passId (.pkpass download)', () => {
    it('streams a signed .pkpass with the pass data', async () => {
      const res = await http()
        .get(`/wallet/apple/${applePassId}`)
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.apple.pkpass');
      expect(res.headers['content-disposition']).toContain('.pkpass');
      expect(res.body.toString()).toBe(`PKPASS:${applePassId}`);

      const passJson = builtPassJsons.at(-1)!;
      expect(passJson.passTypeIdentifier).toBe(PASS_TYPE_ID);
      expect(passJson.storeCard.primaryFields[0]).toMatchObject({ value: '0 / 10' });
      // The barcode must verify with the same secret the stamper uses.
      expect(
        decodeQrPayload(passJson.barcodes[0]!.message, process.env.QR_SIGNING_SECRET!),
      ).toBe(applePassId);

      // The embedded auth token is persisted for the web-service endpoints.
      const [row] = await sql`select apple_auth_token from passes where id = ${applePassId}`;
      expect(row!.appleAuthToken).toBe(passJson.authenticationToken);
      authToken = row!.appleAuthToken as string;
    });

    it('keeps the authentication token stable across downloads', async () => {
      await http().get(`/wallet/apple/${applePassId}`).expect(200);
      expect(builtPassJsons.at(-1)!.authenticationToken).toBe(authToken);
    });

    it('404s for unknown and non-apple passes', async () => {
      await http().get(`/wallet/apple/${randomUUID()}`).expect(404);
      await http().get(`/wallet/apple/${googlePassId}`).expect(404);
    });
  });

  describe('PassKit web service — device registration', () => {
    const registerPath = (serial: string, device = 'device-1') =>
      `/passkit/v1/devices/${device}/registrations/${PASS_TYPE_ID}/${serial}`;

    it('401s without / with a wrong ApplePass token', async () => {
      await http().post(registerPath(applePassId)).send({ pushToken: 't' }).expect(401);
      await http()
        .post(registerPath(applePassId))
        .set('Authorization', 'ApplePass wrong-token')
        .send({ pushToken: 't' })
        .expect(401);
      // Unknown serials are indistinguishable from bad tokens.
      await http()
        .post(registerPath(randomUUID()))
        .set('Authorization', `ApplePass ${authToken}`)
        .send({ pushToken: 't' })
        .expect(401);
    });

    it('201s a new registration, 200s a repeat, and stores the push token', async () => {
      await http()
        .post(registerPath(applePassId))
        .set('Authorization', `ApplePass ${authToken}`)
        .send({ pushToken: 'apns-token-1' })
        .expect(201);
      await http()
        .post(registerPath(applePassId))
        .set('Authorization', `ApplePass ${authToken}`)
        .send({ pushToken: 'apns-token-1b' })
        .expect(200);
      const rows = await sql`
        select platform, push_token from wallet_registrations
        where pass_id = ${applePassId} and device_id = 'device-1'`;
      expect(rows).toEqual([{ platform: 'apple', pushToken: 'apns-token-1b' }]);
    });

    it('400s a registration without a push token', async () => {
      await http()
        .post(registerPath(applePassId))
        .set('Authorization', `ApplePass ${authToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('PassKit web service — updatable passes', () => {
    const listPath = (device = 'device-1') =>
      `/passkit/v1/devices/${device}/registrations/${PASS_TYPE_ID}`;

    it('lists the registered pass with a lastUpdated tag', async () => {
      const res = await http().get(listPath()).expect(200);
      expect(res.body.serialNumbers).toEqual([applePassId]);
      expect(res.body.lastUpdated).toMatch(/^\d+$/);
    });

    it('204s when nothing changed since the tag, lists again after a stamp event', async () => {
      const { body } = await http().get(listPath()).expect(200);
      await http().get(`${listPath()}?passesUpdatedSince=${body.lastUpdated}`).expect(204);

      // A stamp (T4 writes an events row) bumps the pass's change tag.
      await sql`
        insert into events (cafe_id, pass_id, action, detail)
        values (${cafeId}, ${applePassId}, 'stamp', ${sql.json({ count: 1 })})`;
      const after = await http()
        .get(`${listPath()}?passesUpdatedSince=${body.lastUpdated}`)
        .expect(200);
      expect(after.body.serialNumbers).toEqual([applePassId]);
    });

    it('204s for a device with no registrations', async () => {
      await http().get(listPath('device-unknown')).expect(204);
    });
  });

  describe('PassKit web service — latest pass', () => {
    const passPath = `/passkit/v1/passes/${PASS_TYPE_ID}/`;

    it('serves the freshly built .pkpass with Last-Modified', async () => {
      const res = await http()
        .get(passPath + applePassId)
        .set('Authorization', `ApplePass ${authToken}`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/vnd.apple.pkpass');
      expect(res.headers['last-modified']).toBeTruthy();
      expect(res.body.toString()).toBe(`PKPASS:${applePassId}`);
    });

    it('304s when the device already has the current version', async () => {
      const future = new Date(Date.now() + 60_000).toUTCString();
      await http()
        .get(passPath + applePassId)
        .set('Authorization', `ApplePass ${authToken}`)
        .set('If-Modified-Since', future)
        .expect(304);
    });

    it('401s without the pass token', async () => {
      await http()
        .get(passPath + applePassId)
        .expect(401);
    });
  });

  describe('ApplePassPush (WalletPushPort implementation)', () => {
    it('pushes the pass-type topic to every registered device of an apple pass', async () => {
      pushes.length = 0;
      await app.get(ApplePassPush).passChanged(applePassId);
      expect(pushes).toEqual([{ pushToken: 'apns-token-1b', topic: PASS_TYPE_ID }]);
    });

    it('no-ops for non-apple passes', async () => {
      pushes.length = 0;
      await app.get(ApplePassPush).passChanged(googlePassId);
      expect(pushes).toEqual([]);
    });

    it('swallows APNs failures — a dead token must not fail the stamp', async () => {
      failNextPush = true;
      await expect(app.get(ApplePassPush).passChanged(applePassId)).resolves.toBeUndefined();
    });
  });

  describe('PassKit web service — unregister & log', () => {
    it('unregisters the device; the list then 204s', async () => {
      await http()
        .delete(`/passkit/v1/devices/device-1/registrations/${PASS_TYPE_ID}/${applePassId}`)
        .set('Authorization', `ApplePass ${authToken}`)
        .expect(200);
      await http()
        .get(`/passkit/v1/devices/device-1/registrations/${PASS_TYPE_ID}`)
        .expect(204);
      const rows = await sql`
        select id from wallet_registrations where pass_id = ${applePassId}`;
      expect(rows).toHaveLength(0);
    });

    it('accepts device error logs', async () => {
      await http()
        .post('/passkit/v1/log')
        .send({ logs: ['something went wrong on the phone'] })
        .expect(200, {});
    });
  });
});

describe('apple wallet without credentials (no APPLE_* env, no certs)', () => {
  let app: INestApplication;
  let sql: Sql;
  const run = randomUUID().slice(0, 8);
  let cafeId: string;
  let passId: string;

  beforeAll(async () => {
    // Belt and braces: this suite must behave as if Apple was never set up.
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_PASS_TYPE_ID;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);
    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug) values ('No Certs Café', ${`nocerts-${run}`}) returning id`;
    [{ id: passId }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'apple') returning id`;
  });

  afterAll(async () => {
    await sql`delete from passes where cafe_id = ${cafeId}`;
    await sql`delete from cafes where id = ${cafeId}`;
    await app.close();
    await sql.end();
  });

  it('answers 503 wallet_not_configured on .pkpass download', async () => {
    const res = await request(app.getHttpServer()).get(`/wallet/apple/${passId}`);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('wallet_not_configured');
  });

  it('skips APNs pushes instead of failing the mutation', async () => {
    await expect(app.get(ApplePassPush).passChanged(passId)).resolves.toBeUndefined();
  });
});
