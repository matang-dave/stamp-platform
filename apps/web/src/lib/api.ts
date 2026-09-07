// apps/web/src/lib/api.ts
// Thin typed client for the stamp-platform API. All web pages (stamper, owner,
// customer) should go through this module rather than calling fetch directly.
// Request/response shapes come from the frozen contracts in @stamp/core.
import type {
  RedeemRequest,
  RedeemResponse,
  ScanRequest,
  ScanResponse,
  StampRequest,
  StampResponse,
} from '@stamp/core';

// The login exchange is web-only and not part of the frozen core contracts,
// so it is typed here.
export interface LoginRequest {
  cafeSlug: string;
  staffName: string;
  pin: string;
}

export interface LoginResponse {
  token: string;
  staffId: string;
  cafeId: string;
  role: 'owner' | 'barista';
}

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Read lazily so tests can set the env var before the first request; in a Next
// build the literal is inlined at compile time as usual.
function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialized as the request body. */
  body?: unknown;
  /** JWT; sent as `Authorization: Bearer <token>` when present. */
  token?: string;
}

/**
 * Generic JSON fetch against the API. Resolves with the parsed JSON body on
 * 2xx, throws {@link ApiError} otherwise. Extend with new endpoint wrappers
 * below rather than calling this from page code directly.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, token } = options;
  const method = options.method ?? (body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let parsed: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (typeof parsed === 'object' &&
        parsed !== null &&
        'message' in parsed &&
        typeof (parsed as { message: unknown }).message === 'string' &&
        (parsed as { message: string }).message) ||
      `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, parsed);
  }
  return parsed as T;
}

/** Staff PIN login. Keep the returned token in memory only — never persist it. */
export function login(req: LoginRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', { body: req });
}

/** Look up the pass behind a scanned QR payload. */
export function scanPass(req: ScanRequest, token: string): Promise<ScanResponse> {
  return apiFetch<ScanResponse>('/stamper/scan', { body: req, token });
}

/** Add stamps to a pass (`count > 1` only for paper-card migration). */
export function stampPass(req: StampRequest, token: string): Promise<StampResponse> {
  return apiFetch<StampResponse>('/stamper/stamp', { body: req, token });
}

/** Redeem one voucher from a pass. */
export function redeemVoucher(req: RedeemRequest, token: string): Promise<RedeemResponse> {
  return apiFetch<RedeemResponse>('/stamper/redeem', { body: req, token });
}
