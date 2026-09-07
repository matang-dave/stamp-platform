# Stamp Platform MVP — Cloud Agent Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MVP of the multi-tenant digital stamp-card platform (see `docs/mvp-plan.md`) by dispatching independent tasks to cloud agents in dependency-ordered waves.

**Architecture:** One NestJS API (`apps/api`), one Next.js frontend (`apps/web`), shared pure domain logic (`packages/core`), Postgres with `cafe_id` on every tenant-owned row. Wave 0 freezes the DB layer, auth, and API contracts so Wave 1 agents can build backend and frontend in parallel against the same interface; wallet integrations follow in Wave 2; integration hardening in Wave 3.

**Tech Stack:** NestJS 12 (ESM), Next.js (App Router, Tailwind), `postgres` (porsager), `@nestjs/jwt`, vitest, `passkit-generator` (Apple), `googleapis` (Google Wallet).

---

## Orchestration rules (read first, every agent)

1. **One agent = one task = one branch.** Branch name: `agent/task-<N>-<slug>`. Open a PR to `main` when done. Never push to `main` directly.
2. **Never edit files owned by another task** (ownership table below). If you need a change in a file you don't own, write an interface/TODO comment and flag it in your PR description.
3. **Definition of done for every task:** `npm run build && npm run test` green at repo root, plus the task's own "Done when" checks. Commit after every green step, not once at the end.
4. **Contracts are frozen after Wave 0.** If a Wave 1+ task needs a contract change, stop and surface it — don't silently change `packages/core`.
5. Local Postgres for tests: `docker run -d --name stamp-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=stamp_platform -p 5432:5432 postgres:17`. Integration tests apply `db/migrations/*.sql` to a fresh schema per run.
6. Env for dev/tests: copy `.env.example` → `.env`, set `DATABASE_URL=postgres://postgres:dev@localhost:5432/stamp_platform`, `QR_SIGNING_SECRET=dev-secret-0123456789abcdef`, `JWT_SECRET=dev-jwt-0123456789abcdef`.

## Dependency graph

```
Wave 0 (sequential, one agent):   T1 db layer → T2 tenancy+auth → T3 contracts
Wave 1 (4 agents in parallel):    T4 stamper API   T5 enrollment API   T6 stamper UI   T7 enrollment+owner UI
Wave 2 (2 agents in parallel):    T8 Google Wallet   T9 Apple PassKit      [needs T5 merged]
Wave 3 (one agent):               T10 owner API + broadcast → T11 integration E2E + deletion path
Human-only (before Wave 2):       Apple Developer account + Pass Type ID cert; Google Wallet issuer account
```

Merge order within a wave: backend tasks first (T4, T5), then UI tasks rebase and merge (T6, T7).

## File ownership

| Task | Owns (create/modify) |
|---|---|
| T1 | `apps/api/src/db/**`, `scripts/migrate.ts`, `db/migrations/**` |
| T2 | `apps/api/src/auth/**`, `apps/api/src/tenancy/**`, `scripts/create-tenant.ts`, `db/migrations/0002_*.sql` |
| T3 | `packages/core/src/contracts.ts`, `packages/core/src/index.ts` |
| T4 | `apps/api/src/stamper/**` |
| T5 | `apps/api/src/enrollment/**`, `apps/api/src/passes/**` |
| T6 | `apps/web/src/app/stamper/**`, `apps/web/src/lib/api.ts` (creates) |
| T7 | `apps/web/src/app/c/**`, `apps/web/src/app/owner/**` |
| T8 | `apps/api/src/wallet/google/**` |
| T9 | `apps/api/src/wallet/apple/**`, `apps/api/src/passkit/**` |
| T10 | `apps/api/src/owner/**` |
| T11 | `apps/api/test/**`, `apps/api/src/privacy/**` |

`apps/api/src/app.module.ts` is shared: each task adds only its own module import (one line) — merge conflicts there are trivial and expected.

---

## Wave 0 — Foundation (single agent, tasks in order)

### Task 1: Database module + migration runner

**Files:**
- Create: `apps/api/src/db/db.module.ts`, `apps/api/src/db/db.provider.ts`
- Create: `scripts/migrate.ts`
- Modify: `apps/api/src/app.module.ts` (import `DbModule`)
- Test: `apps/api/src/db/db.provider.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/db/db.provider.spec.ts
import { describe, expect, it } from 'vitest';
import { createSql } from './db.provider.js';

describe('createSql', () => {
  it('connects and executes a trivial query', async () => {
    const sql = createSql(process.env.DATABASE_URL!);
    const [row] = await sql`select 1 as one`;
    expect(row!.one).toBe(1);
    await sql.end();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run test --workspace api` → FAIL (`createSql` not defined)
- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/db.provider.ts
import postgres from 'postgres';

export const SQL = Symbol('SQL');
export type Sql = ReturnType<typeof createSql>;

export function createSql(url: string) {
  return postgres(url, { transform: postgres.camel });
}
```

```ts
// apps/api/src/db/db.module.ts
import { Global, Module } from '@nestjs/common';
import { SQL, createSql } from './db.provider.js';

@Global()
@Module({
  providers: [{ provide: SQL, useFactory: () => createSql(process.env.DATABASE_URL!) }],
  exports: [SQL],
})
export class DbModule {}
```

```ts
// scripts/migrate.ts — applies db/migrations/*.sql in filename order, records them in a migrations table
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);
await sql`create table if not exists migrations (name text primary key, applied_at timestamptz default now())`;
const applied = new Set((await sql`select name from migrations`).map((r) => r.name));
for (const f of (await readdir('db/migrations')).sort()) {
  if (applied.has(f)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(await readFile(`db/migrations/${f}`, 'utf8'));
    await tx`insert into migrations (name) values (${f})`;
  });
  console.log('applied', f);
}
await sql.end();
```

- [ ] **Step 4: Install deps, run migration, run tests**

```bash
npm install postgres --workspace api
npm pkg set 'scripts.db:migrate=tsx scripts/migrate.ts' # in root package.json
npm run db:migrate && npm run test --workspace api
```
Expected: `applied 0001_init.sql`, tests PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: db module and migration runner"`

### Task 2: Tenancy + per-barista auth

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `staff.guard.ts`, `current-staff.decorator.ts`
- Create: `scripts/create-tenant.ts` (insert café + owner, print enrollment URL + owner PIN)
- Create: `db/migrations/0002_seed_nothing.sql` only if schema changes are needed (0001 already has `cafes`/`staff`)
- Test: `apps/api/src/auth/auth.service.spec.ts`

Behavior to implement (TDD each bullet, same red-green-commit rhythm as Task 1):
- `POST /auth/login` body `{ cafeSlug, staffName, pin }` → verifies `staff.pin_hash` (use `node:crypto` `scrypt`), returns JWT `{ staffId, cafeId, role }` signed with `JWT_SECRET`, 12h expiry (`@nestjs/jwt`).
- `StaffGuard` reads `Authorization: Bearer`, rejects 401 on missing/invalid, attaches `{ staffId, cafeId, role }` to the request. `@CurrentStaff()` param decorator exposes it.
- **The isolation test that must exist** (this is the acceptance test for multi-tenancy):

```ts
it('a cafe A barista token cannot act on cafe B resources', async () => {
  const tokenA = await login('cafe-a', 'anna', '1234');
  const res = await request(app.getHttpServer())
    .post('/stamper/scan')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ qrPayload: signedPayloadForPassIn('cafe-b') });
  expect(res.status).toBe(403);
});
```
(Write it now with a stub 403 from a `TenancyService.assertSameCafe(cafeId, pass.cafeId)`; T4 keeps it green.)

- `scripts/create-tenant.ts`: `tsx scripts/create-tenant.ts "Café Kranz" cafe-kranz` → inserts café with defaults (10 stamps, no expiry), an `owner` staff row with a random 4-digit PIN, prints both.

- [ ] Red-green-commit per bullet; finish with `npm run build && npm run test` green.

### Task 3: Freeze API contracts

**Files:**
- Create: `packages/core/src/contracts.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './contracts.js'`)

- [ ] **Step 1: Write the contracts file exactly as below** (Wave 1 agents on both sides import these — do not rename fields after merge):

```ts
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
```

- [ ] **Step 2: Build + test + commit** — `npm run build --workspace @stamp/core && npm run test --workspace @stamp/core` → PASS. Commit: `feat: freeze wave-1 API contracts`.

**Done when (Wave 0):** root `npm run build && npm run test` green; `create-tenant` script creates two cafés locally; isolation test exists and passes.

---

## Wave 1 — Parallel lanes (dispatch all four agents at once, after Wave 0 merges)

### Task 4: Stamper API (agent A)

**Files:** `apps/api/src/stamper/stamper.service.ts` (replace stub), `stamper.controller.ts` (add `StaffGuard`), `stamper.service.spec.ts`, integration test `apps/api/src/stamper/stamper.integration.spec.ts`.

Implement against contracts `ScanResponse`/`StampResponse`/`RedeemResponse` using `@stamp/core` (`applyStamps`, `pickVoucherToRedeem`, `voucherExpiresAt`, `isDuplicateScan`, `decodeQrPayload`):
- `scan`: decode QR (secret from env) → `bad_signature`; load pass → `unknown_pass`; compare `pass.cafeId` to session → `wrong_cafe` (HTTP 403 to keep T2's isolation test green); else return summary + `duplicateScanWarning`.
- `stamp`: single transaction — lock pass row (`for update`), `applyStamps`, insert earned vouchers with `voucherExpiresAt(now, cafe.voucherExpiryDays)`, update stamp count, insert `events` row (`action='stamp'`, `staff_id`, count in `detail`). Reject `count > 1` unless `detail`-flagged migration param and log `action='stamp_bulk'`.
- `redeem`: `pickVoucherToRedeem` oldest-first; none → `{ redeemed: false, reason: 'no_voucher' }`; else mark `redeemed_at`/`redeemed_by`, insert `events` row.
- Every mutation ends by calling `WalletPushPort.passChanged(passId)` — define that port here as an injectable interface with a no-op default; T8/T9 bind real implementations:

```ts
export const WALLET_PUSH = Symbol('WALLET_PUSH');
export interface WalletPushPort { passChanged(passId: string): Promise<void> }
```

TDD: integration test per endpoint against local Postgres (fresh schema per run), red-green-commit each.

**Done when:** full counter flow passes in an integration test: enroll (raw SQL insert) → scan → stamp ×10 → voucher appears → redeem → audit log has 12 events with the barista's id.

### Task 5: Enrollment API (agent B)

**Files:** `apps/api/src/enrollment/*` (replace stubs), `apps/api/src/passes/passes.service.ts` (pass CRUD shared with wallet tasks), tests alongside.

- `GET /c/:slug` → `CafePublicInfo` (404 unknown/disabled café).
- `POST /c/:slug/enroll` → validate `EnrollRequest` (zod or class-validator), insert pass (+ `marketing_consent_at = now()` only if `marketingConsent === true`), insert `enroll` event, return `EnrollResponse` with `addToWalletUrl: "/wallet/${platform}/${passId}"` (route stubbed 501 until Wave 2 implements it — the URL shape is part of the contract and matches T8/T9's controllers).
- No auth on these routes (public), but rate-limit enroll: `@nestjs/throttler`, 10/min/IP.

**Done when:** integration test enrolls with and without email; consent timestamp set only on explicit true; disabled café returns 404.

### Task 6: Stamper UI (agent C — frontend, mock the API)

**Files:** `apps/web/src/app/stamper/page.tsx` (replace), `apps/web/src/app/stamper/scanner.tsx`, `apps/web/src/lib/api.ts`; component tests with vitest + testing-library; mock fetch with `msw` against the T3 contract types.

- PIN login form → stores JWT in memory (not localStorage), café name shown.
- Scan view: camera via native `BarcodeDetector` where available, fallback `@zxing/browser`. On scan → `POST /stamper/scan` → show stamp count ●●●●○ and buttons: **+1 stamp**, **Redeem** (only when `vouchersAvailable > 0`), duplicate-scan warning banner with override.
- Long-press on **+1 stamp** reveals "add N stamps (paper card migration)".
- Config: `NEXT_PUBLIC_API_URL`, all calls through `lib/api.ts` typed with `@stamp/core` contracts.

**Done when:** `npm run build --workspace web` green; component tests cover login-fail, scan-success, redeem-visible-only-with-voucher, duplicate-warning; UI works against `msw` mocks (real API wiring is a 5-minute env change at integration).

### Task 7: Enrollment page + owner UI shell (agent D — frontend, mock the API)

**Files:** `apps/web/src/app/c/[slug]/page.tsx` (replace), `apps/web/src/app/c/[slug]/enroll-form.tsx`, `apps/web/src/app/owner/**`.

- Enrollment: fetch `CafePublicInfo` server-side; brand color applied; platform auto-detect (iOS → Apple button first); optional email field + separate unticked consent checkbox labeled explicitly; on submit → redirect to `addToWalletUrl`. Include a short privacy notice section (German + English placeholder text, real copy is a human task).
- Owner: login (reuse `/auth/login`, role must be `owner`), pages for stats (render `OwnerStats`), broadcast form (140-char counter), staff list (read-only in MVP shell; T10 wires the API).

**Done when:** `npm run build --workspace web` green; enroll form validates email format client-side, consent unchecked by default; msw-tested.

---

## Wave 2 — Wallet integrations (after T5 merges; needs human-provisioned credentials)

**Human prerequisites (blockers — do these while Wave 1 runs):** Apple Developer Program membership, Pass Type ID + certificate exported to `certs/` (gitignored); Google Wallet Issuer account + service-account JSON.

### Task 8: Google Wallet (agent E)

**Files:** `apps/api/src/wallet/google/google-wallet.module.ts`, `google-wallet.service.ts`, `google-wallet.controller.ts` (`GET /wallet/google/:passId` → 302 to `https://pay.google.com/gp/v/save/<jwt>`), tests with the Google client mocked.

- One `LoyaltyClass` per café (created lazily on first enroll, id `issuerId.cafe_<cafeId>`), one `LoyaltyObject` per pass; stamps rendered in `loyaltyPoints`; voucher state in a text module.
- Bind `WalletPushPort` (from T4) for google-platform passes: `passChanged` → PATCH the loyalty object.
- All Google API calls behind `GoogleWalletClient` interface so unit tests run without credentials; one manual smoke-test doc `docs/wallet-google-smoke-test.md` with exact steps on a real Android phone.

### Task 9: Apple PassKit (agent F)

**Files:** `apps/api/src/wallet/apple/*`, `apps/api/src/passkit/passkit.controller.ts` (replace stubs), `wallet_registrations` usage, tests with signing mocked.

- `.pkpass` generation with `passkit-generator` (storeCard layout, stamp count as primary field, QR barcode = signed payload from `@stamp/core`); `GET /wallet/apple/:passId` streams it.
- Implement the 5 PassKit web-service endpoints against `wallet_registrations`; `passChanged` → APNs push (empty payload, pass type topic) via `node:http2`.
- Same pattern: `AppleSigner`/`ApnsClient` interfaces mocked in tests; manual smoke-test doc for a real iPhone.

**Done when (both):** unit tests green without credentials; with real certs in `.env`, the smoke-test doc walks enroll → pass in wallet → stamp → pass updates.

---

## Wave 3 — Integration (single agent, after everything merges)

### Task 10: Owner API

**Files:** `apps/api/src/owner/*` (replace stubs) + tests.
- `GET /owner/stats` → `OwnerStats` via three SQL aggregates scoped to session café.
- `POST /owner/broadcast` (role `owner` only) → Google: message field on all café objects; Apple: update pass + push; insert `broadcast` event. 140-char server-side limit.
- Staff CRUD: `POST/DELETE /owner/staff` (create barista with generated PIN, disable staff).

### Task 11: E2E + GDPR deletion path

**Files:** `apps/api/test/acceptance.e2e-spec.ts`, `apps/api/src/privacy/privacy.module.ts` (+controller/service), `scripts/delete-pass-data.ts`.
- E2E (the plan's acceptance test): two cafés; full happy path per café; cross-tenant scan → 403; voucher earned at café-specific threshold (one café configured to 6); redeem consumes oldest voucher.
- Deletion: `tsx scripts/delete-pass-data.ts <passId|email>` → null email/consent, keep anonymized events; also `DELETE /owner/pass/:id/pii` (owner role).
- Fix anything the E2E surfaces; update `README.md` run instructions.

**Done when:** root `npm run build && npm run test` green including E2E against local Postgres; `docs/mvp-plan.md` acceptance test fully automated except the two on-phone wallet smoke tests.

---

## Dispatch checklist (you / coordinator agent)

- [ ] Wave 0: dispatch one agent with Tasks 1–3 (sequential). Review + merge.
- [ ] Provision Apple + Google accounts (human, parallel with Wave 1).
- [ ] Wave 1: dispatch agents A–D simultaneously, each with: repo URL, branch name, its task section verbatim, and the Orchestration rules section.
- [ ] Merge order: T4, T5, then T6, T7 (rebase first).
- [ ] Wave 2: dispatch agents E–F. Merge.
- [ ] Wave 3: dispatch one agent for T10–T11. Merge.
- [ ] Run both wallet smoke tests on real phones; then pilot per `docs/mvp-plan.md` §4 milestone 7.
