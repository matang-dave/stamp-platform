import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type {
  GoogleWalletClient,
  GoogleWalletConfig,
  LoyaltyClassPayload,
  LoyaltyObjectPayload,
  SaveJwtClaims,
} from './google-wallet-client.js';

// Real GoogleWalletClient: Wallet Objects REST API + OAuth2 service-account
// flow (RFC 7523 JWT bearer grant) + RS256 save-link JWT, all with node:crypto
// and fetch — no extra dependency needed. Only constructed when
// GOOGLE_WALLET_ISSUER_ID / GOOGLE_APPLICATION_CREDENTIALS are present.
//
// `fetchImpl` is injectable so the client itself is unit-testable without
// credentials or network (see http-google-wallet.client.spec.ts).

const API_BASE = 'https://walletobjects.googleapis.com/walletobjects/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export class HttpGoogleWalletClient implements GoogleWalletClient {
  private key: ServiceAccountKey | null = null;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: GoogleWalletConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async getClass(classId: string): Promise<LoyaltyClassPayload | null> {
    return this.request<LoyaltyClassPayload>('GET', `/loyaltyClass/${encodeURIComponent(classId)}`);
  }

  async insertClass(cls: LoyaltyClassPayload): Promise<void> {
    await this.request('POST', '/loyaltyClass', cls);
  }

  async getObject(objectId: string): Promise<LoyaltyObjectPayload | null> {
    return this.request<LoyaltyObjectPayload>(
      'GET',
      `/loyaltyObject/${encodeURIComponent(objectId)}`,
    );
  }

  async insertObject(obj: LoyaltyObjectPayload): Promise<void> {
    await this.request('POST', '/loyaltyObject', obj);
  }

  async patchObject(objectId: string, patch: Partial<LoyaltyObjectPayload>): Promise<void> {
    await this.request('PATCH', `/loyaltyObject/${encodeURIComponent(objectId)}`, patch);
  }

  async signSaveJwt(claims: SaveJwtClaims): Promise<string> {
    const key = await this.loadKey();
    return this.signJwt(
      {
        iss: key.client_email,
        aud: 'google',
        typ: 'savetowallet',
        iat: Math.floor(Date.now() / 1000),
        ...claims,
      },
      key,
    );
  }

  // --- internals -----------------------------------------------------------

  private async loadKey(): Promise<ServiceAccountKey> {
    if (!this.key) {
      this.key = JSON.parse(
        await readFile(this.config.credentialsPath, 'utf8'),
      ) as ServiceAccountKey;
    }
    return this.key;
  }

  private signJwt(claims: object, key: ServiceAccountKey): string {
    const unsigned = `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url(claims)}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
    return `${unsigned}.${signature}`;
  }

  private async accessToken(): Promise<string> {
    // Reuse a cached token until 60s before expiry.
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const key = await this.loadKey();
    const now = Math.floor(Date.now() / 1000);
    const assertion = this.signJwt(
      { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
      key,
    );
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`google token endpoint responded ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  /** Returns the parsed body, or null on 404 (resource does not exist). */
  private async request<T>(method: string, path: string, body?: object): Promise<T | null> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`google wallet api ${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }
}
