import { decodeQrPayload } from '@stamp/core';
import { describe, expect, it } from 'vitest';
import { buildPassJson, contrastColor, hexToRgb } from './pass-json.js';
import type { PassJsonInput } from './pass-json.js';
import { solidPng } from './placeholder-icon.js';

const SECRET = 'unit-test-secret-0123456789abcdef';

function input(overrides: Partial<PassJsonInput> = {}): PassJsonInput {
  return {
    passId: '11111111-2222-3333-4444-555555555555',
    cafe: {
      id: 'cafe-1',
      name: 'Café Karma',
      slug: 'karma',
      brandColor: '#6f4e37',
      logoUrl: null,
      stampsRequired: 10,
      status: 'active',
    },
    summary: {
      passId: '11111111-2222-3333-4444-555555555555',
      stamps: 4,
      stampsRequired: 10,
      vouchersAvailable: 2,
      lastStampAt: null,
    },
    authenticationToken: 'a'.repeat(32),
    teamId: 'TEAM123456',
    passTypeId: 'pass.com.example.stamp',
    webServiceUrl: 'https://api.example.com/passkit',
    qrSigningSecret: SECRET,
    ...overrides,
  };
}

describe('hexToRgb / contrastColor', () => {
  it('converts 6- and 3-digit hex, falls back to black on garbage', () => {
    expect(hexToRgb('#6f4e37')).toBe('rgb(111, 78, 55)');
    expect(hexToRgb('#fff')).toBe('rgb(255, 255, 255)');
    expect(hexToRgb('not-a-color')).toBe('rgb(0, 0, 0)');
  });

  it('picks white text on dark brands and black on light ones', () => {
    expect(contrastColor('#000000')).toBe('rgb(255, 255, 255)');
    expect(contrastColor('#ffffff')).toBe('rgb(0, 0, 0)');
    expect(contrastColor('#6f4e37')).toBe('rgb(255, 255, 255)'); // coffee brown
  });
});

describe('buildPassJson', () => {
  it('emits a storeCard with the stamp count as primary field', () => {
    const json = buildPassJson(input());
    expect(json.formatVersion).toBe(1);
    expect(json.serialNumber).toBe('11111111-2222-3333-4444-555555555555');
    expect(json.teamIdentifier).toBe('TEAM123456');
    expect(json.passTypeIdentifier).toBe('pass.com.example.stamp');
    expect(json.webServiceURL).toBe('https://api.example.com/passkit');
    expect(json.authenticationToken).toBe('a'.repeat(32));
    expect(json.organizationName).toBe('Café Karma');
    expect(json.backgroundColor).toBe('rgb(111, 78, 55)');
    expect(json.storeCard.primaryFields).toEqual([
      expect.objectContaining({ key: 'stamps', value: '4 / 10' }),
    ]);
    expect(json.storeCard.secondaryFields).toEqual([
      expect.objectContaining({ key: 'vouchers', value: 2 }),
    ]);
  });

  it('embeds a QR barcode carrying the exact signed payload the stamper scans', () => {
    const json = buildPassJson(input());
    const [barcode] = json.barcodes;
    expect(barcode!.format).toBe('PKBarcodeFormatQR');
    // Round-trip through the shared @stamp/core verifier — same secret, same
    // payload the stamper endpoint decodes.
    expect(decodeQrPayload(barcode!.message, SECRET)).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
    expect(decodeQrPayload(barcode!.message, 'wrong-secret')).toBeNull();
  });
});

describe('solidPng', () => {
  it('produces a valid PNG header and IEND trailer', () => {
    const png = solidPng(29, 111, 78, 55);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
    // IHDR width/height
    expect(png.readUInt32BE(16)).toBe(29);
    expect(png.readUInt32BE(20)).toBe(29);
  });
});
