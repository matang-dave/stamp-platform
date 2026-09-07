// Typed fetch helpers for the public enrollment flow.
// TODO(integration): fold into apps/web/src/lib/api.ts (owned by T6) once both lanes merge.
import type { CafePublicInfo, EnrollRequest, EnrollResponse } from '@stamp/core';

export function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
}

/** GET /c/:slug — returns null for unknown/disabled cafés (API answers 404). */
export async function fetchCafePublicInfo(
  slug: string,
): Promise<CafePublicInfo | null> {
  const res = await fetch(`${apiUrl()}/c/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load café info (${res.status})`);
  return (await res.json()) as CafePublicInfo;
}

/** POST /c/:slug/enroll */
export async function enroll(
  slug: string,
  body: EnrollRequest,
): Promise<EnrollResponse> {
  const res = await fetch(`${apiUrl()}/c/${encodeURIComponent(slug)}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Enrollment failed (${res.status})`);
  return (await res.json()) as EnrollResponse;
}
