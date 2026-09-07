// The Google Wallet client boundary (T8).
//
// EVERY interaction with Google — REST calls to the Wallet Objects API and
// the RS256 signing of the "Save to Google Wallet" JWT — goes through the
// GoogleWalletClient interface. Unit/integration tests replace the provider
// with an in-memory fake, so nothing in this module ever needs real Google
// credentials to be tested.

export const GOOGLE_WALLET_CLIENT = Symbol('GOOGLE_WALLET_CLIENT');
export const GOOGLE_WALLET_CONFIG = Symbol('GOOGLE_WALLET_CONFIG');

export interface GoogleWalletConfig {
  /** Numeric issuer id from the Google Pay & Wallet console. */
  issuerId: string;
  /** Path to the service-account JSON key file. */
  credentialsPath: string;
}

/**
 * Reads the runtime configuration from the environment. Returns null when
 * Google Wallet is not provisioned — the module then serves 503
 * `wallet_not_configured` and the push adapter no-ops.
 */
export function loadGoogleWalletConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleWalletConfig | null {
  const issuerId = env.GOOGLE_WALLET_ISSUER_ID;
  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!issuerId || !credentialsPath) return null;
  return { issuerId, credentialsPath };
}

// --- Minimal shapes of the Wallet Objects API resources we use ------------
// https://developers.google.com/wallet/retail/loyalty-cards/rest

export interface LoyaltyPoints {
  label: string;
  balance: { string: string };
}

export interface TextModule {
  id: string;
  header: string;
  body: string;
}

/**
 * Entry of the loyalty object's `messages` list — Google Wallet surfaces
 * these to the user as pass notifications. (Additive T10 extension: the
 * owner broadcast patches this field on every saved café object.)
 */
export interface WalletObjectMessage {
  id?: string;
  header: string;
  body: string;
}

export interface LoyaltyClassPayload {
  id: string; // `${issuerId}.cafe_${cafeId}`
  issuerName: string;
  programName: string;
  reviewStatus: 'UNDER_REVIEW' | 'DRAFT' | 'APPROVED';
  hexBackgroundColor?: string;
  programLogo?: { sourceUri: { uri: string } };
}

export interface LoyaltyObjectPayload {
  id: string; // `${issuerId}.pass_${passId}`
  classId: string;
  state: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  loyaltyPoints: LoyaltyPoints;
  textModulesData: TextModule[];
  barcode: { type: 'QR_CODE'; value: string; alternateText?: string };
  /** Owner broadcasts (T10); absent until the first broadcast. */
  messages?: WalletObjectMessage[];
}

/** Claims we add on top of the standard save-JWT envelope (iss/aud/typ/iat). */
export interface SaveJwtClaims {
  payload: { loyaltyObjects: Array<{ id: string; classId: string }> };
  origins: string[];
}

export interface GoogleWalletClient {
  /** null when the class does not exist (HTTP 404). */
  getClass(classId: string): Promise<LoyaltyClassPayload | null>;
  insertClass(cls: LoyaltyClassPayload): Promise<void>;
  /** null when the object does not exist (HTTP 404). */
  getObject(objectId: string): Promise<LoyaltyObjectPayload | null>;
  insertObject(obj: LoyaltyObjectPayload): Promise<void>;
  patchObject(objectId: string, patch: Partial<LoyaltyObjectPayload>): Promise<void>;
  /** Signs the Save-to-Google-Wallet JWT (`https://pay.google.com/gp/v/save/<jwt>`). */
  signSaveJwt(claims: SaveJwtClaims): Promise<string>;
}
