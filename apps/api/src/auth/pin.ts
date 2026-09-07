import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// Stored pin_hash format: scrypt:<salt-base64url>:<key-base64url>
// (node:crypto scrypt with default cost params, 16-byte salt, 32-byte key).

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt, 32);
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = pinHash.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  if (expected.length === 0) return false;
  const actual = await scryptAsync(pin, Buffer.from(saltB64, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}
