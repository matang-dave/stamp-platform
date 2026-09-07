// packages/core/src/contracts.ts
export interface StaffSession {
  staffId: string;
  cafeId: string;
  role: 'owner' | 'barista';
}

export interface PassSummary {
  passId: string;
  stamps: number;
  stampsRequired: number;
  vouchersAvailable: number;
  lastStampAt: string | null; // ISO
}

export interface ScanRequest { qrPayload: string }
export type ScanResponse =
  | { valid: true; pass: PassSummary; duplicateScanWarning: boolean }
  | { valid: false; reason: 'bad_signature' | 'unknown_pass' | 'wrong_cafe' };

export interface StampRequest { passId: string; count?: number } // count>1 = paper-card migration only
export interface StampResponse { pass: PassSummary; vouchersEarned: number }

export interface RedeemRequest { passId: string }
export type RedeemResponse =
  | { redeemed: true; pass: PassSummary }
  | { redeemed: false; reason: 'no_voucher' };

export interface EnrollRequest {
  platform: 'apple' | 'google';
  email?: string;
  marketingConsent?: boolean; // unbundled opt-in, defaults false
}
export interface EnrollResponse {
  passId: string;
  addToWalletUrl: string; // Google save link or Apple .pkpass download URL
}

export interface CafePublicInfo { name: string; brandColor: string; stampsRequired: number }

export interface OwnerStats { passesIssued: number; stampsThisWeek: number; vouchersRedeemed: number }
export interface BroadcastRequest { message: string } // <= 140 chars
