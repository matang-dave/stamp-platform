import { encodeQrPayload } from '@stamp/core';
import type { PassSummary } from '@stamp/core';
import type { PassCafeInfo } from '../../passes/passes.service.js';

/** Everything needed to render one storeCard pass.json (pure data in/out). */
export interface PassJsonInput {
  passId: string;
  cafe: PassCafeInfo;
  summary: PassSummary;
  authenticationToken: string;
  teamId: string;
  passTypeId: string;
  webServiceUrl: string;
  qrSigningSecret: string;
  /**
   * Latest owner broadcast (additive T10 extension). When set, it renders as
   * a back field whose changeMessage makes iOS show the broadcast on the
   * lock screen after the APNs-triggered pass refresh.
   */
  latestMessage?: string;
}

export interface ApplePassField {
  key: string;
  label?: string;
  value: string | number;
  changeMessage?: string;
}

/** The subset of the Apple pass.json schema this MVP emits. */
export interface ApplePassJson {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  webServiceURL: string;
  authenticationToken: string;
  organizationName: string;
  description: string;
  logoText: string;
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  barcodes: Array<{ format: 'PKBarcodeFormatQR'; message: string; messageEncoding: string }>;
  storeCard: {
    primaryFields: ApplePassField[];
    secondaryFields: ApplePassField[];
    /** Only present once the café sent its first broadcast (T10). */
    backFields?: ApplePassField[];
  };
}

// Apple pass.json wants `rgb(r, g, b)`, our cafes store hex (#rrggbb / #rgb).
export function hexToRgb(hex: string): string {
  const raw = hex.replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 'rgb(0, 0, 0)';
  const n = parseInt(full, 16);
  return `rgb(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff})`;
}

// White reads well on dark brand colors, black on light ones (WCAG-ish
// relative luminance cut at 0.5).
export function contrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  const [r = 0, g = 0, b = 0] = rgb.match(/\d+/g)!.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
}

/**
 * Builds the storeCard pass.json: stamp count as primary field, vouchers as
 * secondary, QR barcode carrying the SAME signed payload the stamper scans.
 */
export function buildPassJson(input: PassJsonInput): ApplePassJson {
  const { cafe, summary } = input;
  const fg = contrastColor(cafe.brandColor);
  return {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeId,
    teamIdentifier: input.teamId,
    serialNumber: input.passId,
    webServiceURL: input.webServiceUrl,
    authenticationToken: input.authenticationToken,
    organizationName: cafe.name,
    description: `${cafe.name} stamp card`,
    logoText: cafe.name,
    backgroundColor: hexToRgb(cafe.brandColor),
    foregroundColor: fg,
    labelColor: fg,
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: encodeQrPayload(input.passId, input.qrSigningSecret),
        messageEncoding: 'iso-8859-1',
      },
    ],
    storeCard: {
      primaryFields: [
        {
          key: 'stamps',
          label: 'Stamps',
          value: `${summary.stamps} / ${summary.stampsRequired}`,
          changeMessage: 'Stamp card updated: %@',
        },
      ],
      secondaryFields: [
        {
          key: 'vouchers',
          label: 'Free drinks',
          value: summary.vouchersAvailable,
          changeMessage: 'You have %@ free drink(s)!',
        },
      ],
      // Owner broadcast (T10): the changeMessage puts the broadcast text on
      // the customer's lock screen when the pass refreshes.
      ...(input.latestMessage !== undefined
        ? {
            backFields: [
              {
                key: 'broadcast',
                label: cafe.name,
                value: input.latestMessage,
                changeMessage: '%@',
              },
            ],
          }
        : {}),
    },
  };
}
