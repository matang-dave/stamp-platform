import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { encodeQrPayload } from '@stamp/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StaffSession } from '../auth/auth.service.js';
import { createSql } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { StamperService } from './stamper.service.js';
import type { WalletPushPort } from './wallet-push.port.js';

// Vitest does not load the repo-root .env automatically; load it here so the
// test can reach the local Postgres (skipped if DATABASE_URL is already set).
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    // no .env present; rely on the environment
  }
}

class RecordingWalletPush implements WalletPushPort {
  calls: string[] = [];
  async passChanged(passId: string): Promise<void> {
    this.calls.push(passId);
  }
}

describe('StamperService', () => {
  let sql: Sql;
  let service: StamperService;
  let walletPush: RecordingWalletPush;
  // Unique slug per run so repeated runs stay green even if cleanup fails.
  const run = randomUUID().slice(0, 8);
  const slug = `stamper-svc-${run}`;
  let cafeId: string;
  let staffId: string;
  let staff: StaffSession;

  beforeAll(async () => {
    sql = createSql(process.env.DATABASE_URL!);
    walletPush = new RecordingWalletPush();
    service = new StamperService(sql, new TenancyService(), walletPush);

    [{ id: cafeId }] = await sql`
      insert into cafes (name, slug, stamps_required) values ('Svc', ${slug}, 3) returning id`;
    [{ id: staffId }] = await sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${cafeId}, 'svc-barista', 'barista', 'x') returning id`;
    staff = { staffId, cafeId, role: 'barista' };
  });

  afterAll(async () => {
    await sql`delete from events where cafe_id = ${cafeId}`;
    await sql`delete from vouchers where pass_id in
      (select id from passes where cafe_id = ${cafeId})`;
    await sql`delete from passes where cafe_id = ${cafeId}`;
    await sql`delete from staff where cafe_id = ${cafeId}`;
    await sql`delete from cafes where id = ${cafeId}`;
    await sql.end();
  });

  async function newPass(): Promise<string> {
    const [{ id }] = await sql`
      insert into passes (cafe_id, platform) values (${cafeId}, 'google') returning id`;
    return id as string;
  }

  describe('scan', () => {
    it('rejects a tampered payload with bad_signature', async () => {
      const forged = `${randomUUID()}.aaaaaaaaaaaaaaaaaaaaaa`;
      expect(await service.scan({ qrPayload: forged }, staff)).toEqual({
        valid: false,
        reason: 'bad_signature',
      });
    });

    it('rejects a signed non-uuid id with unknown_pass instead of a SQL error', async () => {
      const payload = encodeQrPayload('not-a-uuid', process.env.QR_SIGNING_SECRET!);
      expect(await service.scan({ qrPayload: payload }, staff)).toEqual({
        valid: false,
        reason: 'unknown_pass',
      });
    });

    it('throws 403 for a pass of another cafe', async () => {
      const passId = await newPass();
      const stranger: StaffSession = { staffId, cafeId: randomUUID(), role: 'barista' };
      const payload = encodeQrPayload(passId, process.env.QR_SIGNING_SECRET!);
      await expect(service.scan({ qrPayload: payload }, stranger)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('stamp', () => {
    it('rejects non-positive and fractional counts', async () => {
      const passId = await newPass();
      for (const count of [0, -1, 1.5]) {
        await expect(service.stamp({ passId, count }, staff)).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects bulk counts without the migration flag, even flag=false', async () => {
      const passId = await newPass();
      await expect(service.stamp({ passId, count: 2 }, staff)).rejects.toThrow(BadRequestException);
      await expect(service.stamp({ passId, count: 2, migration: false }, staff)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a malformed pass id with 404 instead of a SQL error', async () => {
      await expect(service.stamp({ passId: 'nope' }, staff)).rejects.toThrow(NotFoundException);
    });

    it('notifies the wallet push port after a successful stamp', async () => {
      const passId = await newPass();
      walletPush.calls = [];
      await service.stamp({ passId }, staff);
      expect(walletPush.calls).toEqual([passId]);
    });

    it('does not notify the wallet push port when the stamp is rejected', async () => {
      const passId = await newPass();
      walletPush.calls = [];
      await expect(service.stamp({ passId, count: 5 }, staff)).rejects.toThrow();
      await expect(service.stamp({ passId: randomUUID() }, staff)).rejects.toThrow();
      expect(walletPush.calls).toEqual([]);
    });
  });

  describe('redeem', () => {
    it('notifies the wallet push port only when a voucher was actually redeemed', async () => {
      const passId = await newPass();
      walletPush.calls = [];
      expect(await service.redeem({ passId }, staff)).toEqual({
        redeemed: false,
        reason: 'no_voucher',
      });
      expect(walletPush.calls).toEqual([]);

      await sql`insert into vouchers (pass_id) values (${passId})`;
      const res = await service.redeem({ passId }, staff);
      expect(res.redeemed).toBe(true);
      expect(walletPush.calls).toEqual([passId]);
    });

    it('rejects a malformed pass id with 404 instead of a SQL error', async () => {
      await expect(service.redeem({ passId: 'nope' }, staff)).rejects.toThrow(NotFoundException);
    });
  });
});
