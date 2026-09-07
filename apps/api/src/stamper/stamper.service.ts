import { Inject, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { decodeQrPayload, isDuplicateScan } from '@stamp/core';
import type { PassSummary, ScanResponse } from '@stamp/core';
import type { StaffSession } from '../auth/auth.service.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { TenancyService } from '../tenancy/tenancy.service.js';

export interface ScanDto {
  qrPayload: string;
}

export interface StampDto {
  passId: string;
  // count > 1 only for paper-card migration at enrollment (hidden staff UI action).
  count?: number;
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

  stamp(body: StampDto) {
    // TODO(milestone 2): core.applyStamps in a transaction, create vouchers
    // (expiry from cafe config at earn time), append audit event, push wallet update.
    throw new NotImplementedException(`stamp(${body.passId})`);
  }

  redeem(body: RedeemDto) {
    // TODO(milestone 2): core.pickVoucherToRedeem (oldest first), mark redeemed,
    // append audit event with barista id, push wallet update.
    throw new NotImplementedException(`redeem(${body.passId})`);
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
