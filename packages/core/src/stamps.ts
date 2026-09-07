export interface StampState {
  stamps: number;
  stampsRequired: number;
}

export interface StampResult {
  stamps: number;
  vouchersEarned: number;
}

export function applyStamps(state: StampState, count: number): StampResult {
  if (count < 1 || !Number.isInteger(count)) {
    throw new Error(`invalid stamp count: ${count}`);
  }
  const total = state.stamps + count;
  return {
    stamps: total % state.stampsRequired,
    vouchersEarned: Math.floor(total / state.stampsRequired),
  };
}

export function voucherExpiresAt(earnedAt: Date, expiryDays: number | null): Date | null {
  if (expiryDays === null) return null;
  return new Date(earnedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

export interface RedeemableVoucher {
  id: string;
  createdAt: Date;
  expiresAt: Date | null;
}

// Oldest-first so banked vouchers are consumed before newer ones expire.
export function pickVoucherToRedeem(
  vouchers: RedeemableVoucher[],
  now: Date,
): RedeemableVoucher | null {
  const valid = vouchers
    .filter((v) => v.expiresAt === null || v.expiresAt > now)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return valid[0] ?? null;
}

export const DUPLICATE_SCAN_WINDOW_MINUTES = 3;

export function isDuplicateScan(lastStampAt: Date | null, now: Date): boolean {
  if (lastStampAt === null) return false;
  return now.getTime() - lastStampAt.getTime() < DUPLICATE_SCAN_WINDOW_MINUTES * 60 * 1000;
}
