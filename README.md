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
cp .env.example .env       # fill in DATABASE_URL + QR_SIGNING_SECRET
npm run test               # core domain tests
npm run dev:api            # NestJS on :3000
npm run dev:web            # Next.js on :3001 (pass -- -p 3001)
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
