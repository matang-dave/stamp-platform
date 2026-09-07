import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { SQL } from '../../db/db.provider.js';
import type { Sql } from '../../db/db.provider.js';
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

// Runtime behavior WITHOUT provisioned Google Wallet credentials: the save
// endpoint answers 503 wallet_not_configured, and the push adapter no-ops.
describe('google wallet (unconfigured — no credentials in env)', () => {
  let app: INestApplication;
  let sql: Sql;
  const run = randomUUID().slice(0, 8);
  const slug = `gwallet-off-${run}`;
  let cafeId: string;
  let googlePassId: string;

  beforeAll(async () => {
    // Simulate the not-provisioned environment regardless of the host's env.
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    sql = app.get<Sql>(SQL);

    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug) values ('Offline Café', ${slug}) returning id`;
    [{ id: googlePassId }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'google') returning id`;
  });

  afterAll(async () => {
    await sql`delete from passes where cafe_id = ${cafeId}`;
    await sql`delete from cafes where id = ${cafeId}`;
    await app.close();
    await sql.end();
  });

  it('GET /wallet/google/:passId answers 503 wallet_not_configured', async () => {
    const res = await request(app.getHttpServer()).get(`/wallet/google/${googlePassId}`);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('wallet_not_configured');
  });

  it('GoogleWalletPush.passChanged no-ops without throwing', async () => {
    const push = app.get(GoogleWalletPush);
    await expect(push.passChanged(googlePassId)).resolves.toBeUndefined();
  });
});
