# stamp-platform

Multi-tenant digital stamp cards for cafés — wallet passes instead of paper.
Default program: 10 stamps = 1 free coffee. See [docs/mvp-plan.md](docs/mvp-plan.md)
for the full plan and decision history.

## Layout

```
apps/api        NestJS backend: enrollment, stamper, owner admin, PassKit web service
apps/web        Next.js frontend: enrollment page, stamper PWA, owner admin
packages/core   Pure domain logic: stamp math, voucher rules, QR signing (shared, unit-tested)
db/migrations   Postgres schema — cafe_id on every tenant-owned row
docs            MVP plan, GDPR notes
```

## Getting started

```
npm install
docker run -d --name stamp-pg -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=stamp_platform -p 5432:5432 postgres:17
cp .env.example .env       # set DATABASE_URL, QR_SIGNING_SECRET, JWT_SECRET
npm run db:migrate         # applies db/migrations/*.sql
npm run build              # core + api + web
npm run test               # all suites incl. integration + e2e (needs Postgres)
npm run dev:api            # NestJS on :3000
npm run dev:web            # Next.js on :3001 (pass -- -p 3001)
```

The API integration and e2e tests (`apps/api/src/**/*.integration.spec.ts`,
`apps/api/test/*.e2e-spec.ts`) run against the `DATABASE_URL` Postgres with
the migrations applied; they create uniquely-slugged cafés and clean up after
themselves. Wallet credentials are never required — Google/Apple clients are
faked in tests and no-op gracefully in dev.

## Operator scripts

```
npx tsx scripts/create-tenant.ts "Café Kranz" cafe-kranz
    # creates the café + an owner login, prints enrollment URL and owner PIN

npx tsx scripts/delete-pass-data.ts <passId|email>
    # GDPR deletion path: nulls email + marketing consent on matching passes,
    # keeps the (already anonymized) audit events, logs a pii_erased event.
    # Owners can do the same per pass via DELETE /owner/pass/:id/pii.
```

## Ground rules

- Tenancy: `cafe_id` is derived server-side from the staff session or scanned
  pass — never accepted from client input.
- GDPR: email is optional; marketing consent is a separate, unbundled opt-in.
  Each café is the controller, the platform is the processor (AVV per tenant).
- Vouchers: earned automatically at the café's stamp threshold, redeemed
  oldest-first at the counter; expiry is a per-café config, never retroactive.

## Milestones

1. Tenancy skeleton: cafés, per-barista auth, tenant isolation
2. Core loop: scan → stamp → voucher → redeem with audit log
3. Google Wallet passes + enrollment page
4. Apple PassKit web service + APNs updates
5. Hardening: duplicate-scan guard, cross-tenant rejection, deletion path
6. Owner mini-admin: staff, config, broadcast push, stats
7. Pilot at café #1 (Berlin)
