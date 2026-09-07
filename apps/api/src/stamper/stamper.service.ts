import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { applyStamps, decodeQrPayload, isDuplicateScan, voucherExpiresAt } from '@stamp/core';
import type { PassSummary, ScanResponse, StampResponse } from '@stamp/core';
import type { StaffSession } from '../auth/auth.service.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { WALLET_PUSH } from './wallet-push.port.js';
import type { WalletPushPort } from './wallet-push.port.js';

export interface ScanDto {
  qrPayload: string;
}

export interface StampDto {
  passId: string;
  // count > 1 only for paper-card migration at enrollment (hidden staff UI
  // action); it must be explicitly flagged with `migration` and is audited
  // as 'stamp_bulk'.
  count?: number;
  migration?: boolean;
}

export interface RedeemDto {
  passId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class StamperService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tenancy: TenancyService,
    @Inject(WALLET_PUSH) private readonly walletPush: WalletPushPort,
  ) {}

  async scan(body: ScanDto, staff: StaffSession): Promise<ScanResponse> {
    const passId = decodeQrPayload(body.qrPayload ?? '', process.env.QR_SIGNING_SECRET ?? '');
    if (passId === null) {
      return { valid: false, reason: 'bad_signature' };
    }
    // Guard against signed-but-malformed ids so Postgres never sees an invalid uuid.
    if (!UUID_RE.test(passId)) {
      return { valid: false, reason: 'unknown_pass' };
    }
    // Tenancy check (T2): a barista can only act on passes of their own cafe.
    const [pass] = await this.sql`select cafe_id from passes where id = ${passId}`;
    if (!pass) {
      return { valid: false, reason: 'unknown_pass' };
    }
    this.tenancy.assertSameCafe(staff.cafeId, pass.cafeId as string);

    const summary = await this.passSummary(this.sql, passId);
    const lastStampAt = summary.lastStampAt === null ? null : new Date(summary.lastStampAt);
    return {
      valid: true,
      pass: summary,
      duplicateScanWarning: isDuplicateScan(lastStampAt, new Date()),
    };
  }

  async stamp(body: StampDto, staff: StaffSession): Promise<StampResponse> {
    const count = body.count ?? 1;
    const migration = body.migration === true;
    if (!Number.isInteger(count) || count < 1) {
      throw new BadRequestException('invalid_count');
    }
    // count > 1 is reserved for the flagged paper-card migration flow.
    if (count > 1 && !migration) {
      throw new BadRequestException('bulk_stamp_requires_migration_flag');
    }

    const response = await this.sql.begin(async (tx) => {
      // Lock the pass row: concurrent stamps must serialize so stamp counts
      // and earned vouchers never race.
      const [pass] = await tx`
        select p.id, p.cafe_id, p.stamps, c.stamps_required, c.voucher_expiry_days
        from passes p
        join cafes c on c.id = p.cafe_id
        where p.id = ${this.uuidOrNotFound(body.passId)}
        for update of p`;
      if (!pass) {
        throw new NotFoundException('unknown_pass');
      }
      this.tenancy.assertSameCafe(staff.cafeId, pass.cafeId as string);

      const result = applyStamps(
        { stamps: pass.stamps as number, stampsRequired: pass.stampsRequired as number },
        count,
      );
      await tx`update passes set stamps = ${result.stamps} where id = ${pass.id}`;

      const action = count > 1 ? 'stamp_bulk' : 'stamp';
      const detail = migration ? { count, migration: true } : { count };
      await tx`
        insert into events (cafe_id, staff_id, pass_id, action, detail)
        values (${pass.cafeId}, ${staff.staffId}, ${pass.id}, ${action}, ${tx.json(detail)})`;

      // Expiry is fixed from cafe config at earn time — never retroactive.
      const expiresAt = voucherExpiresAt(new Date(), pass.voucherExpiryDays as number | null);
      for (let i = 0; i < result.vouchersEarned; i++) {
        const [voucher] = await tx`
          insert into vouchers (pass_id, expires_at) values (${pass.id}, ${expiresAt})
          returning id`;
        await tx`
          insert into events (cafe_id, staff_id, pass_id, action, detail)
          values (${pass.cafeId}, ${staff.staffId}, ${pass.id}, 'voucher_earned',
                  ${tx.json({ voucherId: voucher!.id as string })})`;
      }

      return {
        pass: await this.passSummary(tx, pass.id as string),
        vouchersEarned: result.vouchersEarned,
      };
    });

    await this.walletPush.passChanged(body.passId);
    return response;
  }

  redeem(body: RedeemDto, _staff: StaffSession) {
    // TODO(milestone 2): core.pickVoucherToRedeem (oldest first), mark redeemed,
    // append audit event with barista id, push wallet update.
    throw new NotImplementedException(`redeem(${body.passId})`);
  }

  // Rejects ids Postgres could not even parse as uuid with the same 404 a
  // missing row gets, so callers cannot distinguish (or crash) on garbage input.
  private uuidOrNotFound(passId: string): string {
    if (!UUID_RE.test(passId ?? '')) {
      throw new NotFoundException('unknown_pass');
    }
    return passId;
  }

  // Loads the PassSummary shared by all stamper responses. Callable with the
  // pool or a transaction handle so mutations report post-commit state.
  private async passSummary(sql: Sql, passId: string): Promise<PassSummary> {
    const [row] = await sql`
      select
        p.id,
        p.stamps,
        c.stamps_required,
        (select count(*)::int from vouchers v
          where v.pass_id = p.id
            and v.redeemed_at is null
            and (v.expires_at is null or v.expires_at > now())) as vouchers_available,
        (select max(e.created_at) from events e
          where e.pass_id = p.id and e.action in ('stamp', 'stamp_bulk')) as last_stamp_at
      from passes p
      join cafes c on c.id = p.cafe_id
      where p.id = ${passId}`;
    if (!row) {
      throw new NotFoundException('unknown_pass');
    }
    return {
      passId: row.id as string,
      stamps: row.stamps as number,
      stampsRequired: row.stampsRequired as number,
      vouchersAvailable: row.vouchersAvailable as number,
      lastStampAt: row.lastStampAt === null ? null : (row.lastStampAt as Date).toISOString(),
    };
  }
}
