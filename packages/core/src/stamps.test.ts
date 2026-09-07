import { describe, expect, it } from 'vitest';
import {
  applyStamps,
  isDuplicateScan,
  pickVoucherToRedeem,
  voucherExpiresAt,
} from './stamps.js';
import { decodeQrPayload, encodeQrPayload } from './qr.js';

describe('applyStamps', () => {
  it('adds a stamp below the threshold', () => {
    expect(applyStamps({ stamps: 3, stampsRequired: 10 }, 1)).toEqual({
      stamps: 4,
      vouchersEarned: 0,
    });
  });

  it('earns a voucher and resets at the threshold', () => {
    expect(applyStamps({ stamps: 9, stampsRequired: 10 }, 1)).toEqual({
      stamps: 0,
      vouchersEarned: 1,
    });
  });

  it('handles bulk migration stamps crossing the threshold', () => {
    expect(applyStamps({ stamps: 8, stampsRequired: 10 }, 13)).toEqual({
      stamps: 1,
      vouchersEarned: 2,
    });
  });

  it('respects per-cafe threshold config', () => {
    expect(applyStamps({ stamps: 5, stampsRequired: 6 }, 1)).toEqual({
      stamps: 0,
      vouchersEarned: 1,
    });
  });

  it('rejects non-positive counts', () => {
    expect(() => applyStamps({ stamps: 0, stampsRequired: 10 }, 0)).toThrow();
  });
});

describe('voucherExpiresAt', () => {
  it('returns null when the cafe has no expiry', () => {
    expect(voucherExpiresAt(new Date(), null)).toBeNull();
  });

  it('adds the configured days', () => {
    const earned = new Date('2026-01-01T00:00:00Z');
    expect(voucherExpiresAt(earned, 90)).toEqual(new Date('2026-04-01T00:00:00Z'));
  });
});

describe('pickVoucherToRedeem', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('picks the oldest unexpired voucher', () => {
    const picked = pickVoucherToRedeem(
      [
        { id: 'new', createdAt: new Date('2026-05-01'), expiresAt: null },
        { id: 'old', createdAt: new Date('2026-04-01'), expiresAt: null },
      ],
      now,
    );
    expect(picked?.id).toBe('old');
  });

  it('skips expired vouchers', () => {
    const picked = pickVoucherToRedeem(
      [
        { id: 'expired', createdAt: new Date('2026-01-01'), expiresAt: new Date('2026-05-01') },
        { id: 'valid', createdAt: new Date('2026-03-01'), expiresAt: null },
      ],
      now,
    );
    expect(picked?.id).toBe('valid');
  });

  it('returns null when nothing is redeemable', () => {
    expect(pickVoucherToRedeem([], now)).toBeNull();
  });
});

describe('isDuplicateScan', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('flags a scan within the window', () => {
    expect(isDuplicateScan(new Date('2026-06-01T11:58:30Z'), now)).toBe(true);
  });

  it('allows a scan outside the window', () => {
    expect(isDuplicateScan(new Date('2026-06-01T11:00:00Z'), now)).toBe(false);
  });

  it('allows the first scan ever', () => {
    expect(isDuplicateScan(null, now)).toBe(false);
  });
});

describe('qr payload signing', () => {
  const secret = 'test-secret-at-least-16-chars';

  it('round-trips a signed pass id', () => {
    const payload = encodeQrPayload('pass-123', secret);
    expect(decodeQrPayload(payload, secret)).toBe('pass-123');
  });

  it('rejects a tampered payload', () => {
    const payload = encodeQrPayload('pass-123', secret);
    expect(decodeQrPayload(payload.replace('pass-123', 'pass-999'), secret)).toBeNull();
  });

  it('rejects a payload signed with a different secret', () => {
    const payload = encodeQrPayload('pass-123', 'some-other-secret-xxxx');
    expect(decodeQrPayload(payload, secret)).toBeNull();
  });
});
