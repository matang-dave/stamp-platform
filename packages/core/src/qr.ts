import { createHmac, timingSafeEqual } from 'node:crypto';

// QR payload format: <passId>.<hmac> — signing prevents forging a pass by guessing IDs.

function sign(passId: string, secret: string): string {
  return createHmac('sha256', secret).update(passId).digest('base64url').slice(0, 22);
}

export function encodeQrPayload(passId: string, secret: string): string {
  return `${passId}.${sign(passId, secret)}`;
}

export function decodeQrPayload(payload: string, secret: string): string | null {
  const dot = payload.lastIndexOf('.');
  if (dot === -1) return null;
  const passId = payload.slice(0, dot);
  const given = payload.slice(dot + 1);
  const expected = sign(passId, secret);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return passId;
}
