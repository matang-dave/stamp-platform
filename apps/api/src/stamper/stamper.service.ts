import { Injectable, NotImplementedException } from '@nestjs/common';
import { decodeQrPayload } from '@stamp/core';

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
  scan(body: ScanDto) {
    const passId = decodeQrPayload(body.qrPayload, process.env.QR_SIGNING_SECRET ?? '');
    if (passId === null) {
      return { valid: false as const };
    }
    // TODO(milestone 2): load pass + vouchers, reject cross-tenant scans,
    // warn on duplicate scan within the window (core.isDuplicateScan).
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
