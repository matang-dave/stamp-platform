// Typed fetch helpers for the owner mini-admin.
// TODO(integration): fold into apps/web/src/lib/api.ts (owned by T6) once both lanes merge.
import type { BroadcastRequest, OwnerStats, StaffSession } from '@stamp/core';

export function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
}

export type LoginResponse = StaffSession & { token: string };

/** POST /auth/login — same endpoint the stamper uses; owner pages require role 'owner'. */
export async function login(
  cafeSlug: string,
  staffName: string,
  pin: string,
): Promise<LoginResponse> {
  const res = await fetch(`${apiUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cafeSlug, staffName, pin }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  return (await res.json()) as LoginResponse;
}

/** GET /owner/stats */
export async function fetchOwnerStats(token: string): Promise<OwnerStats> {
  const res = await fetch(`${apiUrl()}/owner/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return (await res.json()) as OwnerStats;
}

/** POST /owner/broadcast */
export async function sendBroadcast(
  token: string,
  body: BroadcastRequest,
): Promise<void> {
  const res = await fetch(`${apiUrl()}/owner/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Broadcast failed (${res.status})`);
}
