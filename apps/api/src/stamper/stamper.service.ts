import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { decodeQrPayload } from '@stamp/core';
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

@Injectable()
export class StamperService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tenancy: TenancyService,
  ) {}

  async scan(body: ScanDto, staff: StaffSession) {
    const passId = decodeQrPayload(body.qrPayload, process.env.QR_SIGNING_SECRET ?? '');
    if (passId === null) {
      return { valid: false as const };
    }
    // Tenancy check (T2): a barista can only act on passes of their own cafe.
    const [pass] = await this.sql`select cafe_id from passes where id = ${passId}`;
    if (pass) {
      this.tenancy.assertSameCafe(staff.cafeId, pass.cafeId as string);
    }
    // TODO(milestone 2, T4): load pass + vouchers, warn on duplicate scan
    // within the window (core.isDuplicateScan).
    throw new NotImplementedException(`scan(${passId})`);
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
}
