# Digital Stamp Card — MVP Plan
*A multi-tenant digital stamp-card platform, piloted at a Berlin café. Default program: 10 stamps = 1 free coffee.*

> **Rev 2 decisions:** per-barista logins · configurable voucher expiry · email capture (optional) · **multi-tenancy from day 1**. The pilot café is tenant #1, not the product.

---

## 1. What existing solutions taught us

Researched: Loopy Loyalty, LoyaltyPass, Stamp Me, and the German market (Stempely, QARD, Hillcard, gobonki, Passcreator, Mankido, hello again).

**Where the whole market converged:**

| Pattern | Detail |
|---|---|
| Wallet pass, not an app | Every modern player issues a branded pass into Apple/Google Wallet. Standalone-app providers (hello again, Mankido) are the legacy tier — app-install friction kills adoption for a single café. |
| QR enrollment at the counter | Customer scans a printed QR → lands on a web page → pass drops into their wallet. Under 30 seconds, no download. |
| Staff "stamper app" | Barista scans the QR **on the customer's pass** with any phone. Card, balance, and available rewards appear instantly; add stamp or redeem reward in one tap, with a confirm step to prevent mistakes. Loopy even supports stamp + redeem in a single scan. |
| Wallet push instead of email | Lock-screen messages go to the pass itself (~90% visibility claimed). **This solves the marketing goal without collecting any email address.** |
| Minimal-data enrollment | Stempely markets *zero-PII* cards as a DSGVO feature in Germany: anonymous pass ID, stamp count, last-visit date. No name/email/phone → almost no GDPR surface, no consent flow, no double opt-in. |
| Anti-fraud | Authenticated stamper devices + full audit trail of every stamp/redemption. |
| Price anchor | SaaS runs $25–99/month. Our build should stay simpler than what $25/month buys, or we're doing it wrong. |

**Decisions this research changes/confirms from our grilling session:**
- ✅ Confirms: wallet pass + QR, barista-scans-customer, counter redemption.
- 🆕 Sign-up: **email is an optional field with an unbundled marketing-consent checkbox** — the pass works fine without it (anonymous pass ID). Wallet push remains the primary marketing channel; email is for pass recovery + opted-in newsletters.
- 🆕 Paper-card migration: the stamper's "add N stamps" capability (used once, at enrollment) migrates existing half-full paper cards — barista scans the new pass, adds the paper card's stamp count, bins the paper card.

---

## 2. MVP scope

### In scope
1. **Multi-tenancy** — every café is a tenant with its own branding, counter QR, staff, program config, and data isolation (`cafe_id` on every row). Café onboarding is **admin-manual** for MVP (you create the tenant); self-serve signup is v2.
2. **Enrollment page** (per-café URL) — counter QR → mobile web page → "Add to Apple Wallet" / "Add to Google Wallet". **One optional email field** + separate, unticked marketing-consent checkbox. Privacy policy link (now a real one — we store PII).
3. **The pass** — per-café branding, visual stamp count (e.g. ●●●●●○○○○○), QR carrying the pass ID, "1 voucher available" state.
4. **Stamper web app** (staff-facing, mobile browser + camera — no native app):
   - **Per-barista login** (each barista gets their own PIN/account, scoped to their café; owner role can manage baristas). Every stamp/redeem in the audit log carries the barista's identity.
   - Scan pass → see balance → **[+1 Stamp]** / **[Redeem free coffee]** (shown only when unexpired voucher exists) → confirm.
   - "Add N stamps" hidden behind a long-press/menu, for paper-card migration only.
5. **Core logic** — at N stamps (per-café config, default 10): auto-create voucher, reset count to 0. Redemption consumes voucher. Every action appended to an audit log.
6. **Pass updates** — stamp/voucher changes push to the wallet pass (APNs for Apple, Wallet Objects API for Google).
7. **Café owner mini-admin** — manage baristas, program config (stamps required, voucher expiry), broadcast a lock-screen push to their café's passes, see basic stats (passes issued, stamps this week, vouchers redeemed).
8. **Platform admin** — create/disable tenants. A page or even a CLI script is fine for MVP.

### Explicitly out of scope (v2+)
- Self-serve café onboarding and **billing/subscriptions** (pilot café is free; don't build Stripe yet)
- Email *sending* (we capture and store; newsletters/campaigns are v2 — avoids building unsubscribe infra now)
- POS integration
- Per-drink or quantity stamping (1 scan = 1 stamp, barista judgment)
- Customer self-serve redemption
- Analytics dashboards, segmentation, birthday offers

### Business rules (per-café config, with platform defaults)
- 1 stamp per visit, barista's judgment on what qualifies.
- Stamps required for reward: **configurable**, default 10.
- Voucher expiry: **configurable**, default *never*. Expiry is evaluated at redemption time (no cron needed); pass shows the expiry date if set. If a café enables expiry later, it applies only to newly earned vouchers — never retroactively (that's a trust-killer).
- Redeeming a free coffee does **not** also earn a stamp (matches paper convention).
- Multiple vouchers can be banked; oldest voucher is redeemed first (matters once expiry exists).
- Duplicate-scan guard: same pass stamped twice within N minutes → stamper warns, barista can override (covers "I forgot to stamp" honestly, blocks accidental double-taps).

---

## 3. Architecture (deliberately boring)

```
Customer phone                    Counter phone (staff)
  Wallet pass (QR = pass ID)        Stamper web app (camera scan)
        │                                   │
        └──────────────┬────────────────────┘
                       ▼
              Single web service
   (enrollment + stamper + owner admin + API)
                       │
              Postgres (cafe_id everywhere)
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  Apple PassKit (APNs push)   Google Wallet API
```

- **One web service** (pick your comfort stack — e.g. Next.js or FastAPI + a page of vanilla JS). Serves enrollment pages, stamper PWA, owner admin, and the pass endpoints. Multi-tenant ≠ microservices — it's still one boring app.
- **Data model — 6 tables:** `cafes` (tenant: name, branding, stamps_required, voucher_expiry_days, status), `staff` (cafe_id, name, role owner|barista, PIN hash), `passes` (id, cafe_id, platform, stamps, email nullable, marketing_consent_at nullable, created_at, last_seen), `vouchers` (pass_id, created_at, expires_at nullable, redeemed_at, redeemed_by), `events` (audit log: cafe_id, staff_id, pass_id, action, timestamp), `wallet_registrations` (push tokens).
- **Tenancy rule:** every query is scoped by `cafe_id` derived from the authenticated staff session or the pass — never from client input. Postgres over SQLite now that multiple businesses share the DB.
- **QR content:** signed pass ID (e.g. `pass_id.hmac`) so a QR can't be forged by guessing IDs. Scanning a pass from café A while logged into café B → hard error.
- **Apple side:** ONE Apple Developer account (€99/yr) + one Pass Type ID serves all tenants — per-café branding lives in each pass's images/colors. Implement the PassKit web service spec (register/unregister device, get updated pass, APNs push).
- **Google side:** free; one Google Wallet Issuer account, **one Loyalty Class per café**, Loyalty Objects per customer; updates are direct object PATCHes.
- **Hosting:** any EU-region host (Hetzner/Fly EU) — keeps the "data stays in the EU" line true and Schrems-II-proof.

### GDPR posture (Berlin-ready — now with real obligations)
Email capture + multi-tenancy upgrade this from "trivial" to "small but real":
- **Roles:** each café is the *Verantwortlicher* (controller) for its customers' data; you (the platform) are the *Auftragsverarbeiter* (processor). You need an **AVV/DPA signed with every café** — write it once as a template, it's part of tenant onboarding.
- **Consent:** email field optional; marketing consent is a separate, unticked checkbox (unbundled, Art. 7). Store the consent timestamp. No email sending in MVP means no unsubscribe infra yet — but log consent correctly now.
- **Rights:** a deletion path must exist (pass ID or email lookup → purge PII, keep anonymized stamp events). A manual admin action is fine for MVP; it just has to work within 30 days of a request.
- Passes without email remain effectively anonymous: pass ID, stamp count, timestamps, push tokens.
- Wallet push messages go to the pass, not to a person → still no marketing-consent apparatus needed for those.

---

## 4. Build order

| # | Milestone | Proves | Effort* |
|---|---|---|---|
| 1 | Tenancy skeleton: `cafes` + `staff` + per-barista auth + platform-admin tenant creation (CLI ok) | Two test cafés fully isolated from each other | 1–2 days |
| 2 | Core loop + stamper web app using a **fake pass** (printed test QR): scan → stamp → voucher (config N) → redeem, audit log with barista identity | The counter transaction, tenant-scoped | 1–2 days |
| 3 | Google Wallet: enrollment page (optional email + consent) → real pass → stamp count updates; Loyalty Class per café | End-to-end on Android (easier API — do it first) | 2 days |
| 4 | Apple pass + PassKit web service + APNs updates | End-to-end on iPhone (the fiddly one: certs, pkpass signing) | 2–4 days |
| 5 | Hardening: duplicate-scan guard, cross-tenant scan rejection, migration "add N stamps", voucher expiry logic, deletion path | Safe to hand to baristas + GDPR-answerable | 1–2 days |
| 6 | Owner mini-admin: barista management, config, broadcast push, stats | The café owner's payoff | 1–2 days |
| 7 | **Pilot:** onboard the Berlin café as tenant #1 (incl. signed AVV), print counter QR, migrate paper cards for one week, staff feedback | Reality | 1 week |

*Effort assumes evenings/side-project pace units, i.e. "days" of focused work. Multi-tenancy from day 1 adds roughly 3–4 days versus the single-café version — cheap now, brutal to retrofit.

### MVP acceptance test
Two cafés exist and can't see each other's data. A customer with no app installed goes from counter QR → pass in wallet in <30s (with or without giving an email); a logged-in barista stamps them in <5s and the audit log names that barista; at the café's configured stamp count the pass shows a voucher within a minute; next visit any barista of that café redeems it; the owner changes voucher expiry and sends one push that appears on the customer's lock screen.

---

## 5. Open questions (parked, not blocking)
1. ~~Shared vs. per-barista login~~ → **per-barista** (decided).
2. ~~Voucher expiry~~ → **configurable per café**, default never (decided).
3. ~~Email capture~~ → **yes, optional field + unbundled marketing consent** (decided).
4. ~~Multi-tenancy~~ → **from day 1** (decided). Pilot café is tenant #1.
5. Billing model for tenant #2+ (flat €/month like the market's €25–99 anchor?) — decide before onboarding a paying café, not before the pilot.
6. Self-serve café onboarding vs. concierge — stay concierge until ≥3 cafés ask.
7. Platform brand vs. café brand on the enrollment page ("powered by X" footer?) — marketing decision, zero code impact now.
8. Email *sending* (recovery links, newsletters) — v2; requires unsubscribe infra and a mail provider with EU processing.

## Sources
- [Loopy Loyalty pricing](https://loopyloyalty.com/pricing/) · [Loopy stamper app docs](https://docs.loopyloyalty.com/en/articles/10502182-using-the-ios-stamper-app) · [Loopy product overview](https://docs.loopyloyalty.com/en/articles/11142679-loopy-loyalty-your-digital-stamp-card-solution)
- [Coffee shop loyalty guide 2026 (LoyaltyPass)](https://www.loyaltypass.co/blog/industries/coffee-shop-loyalty-program) · [LoyaltyPass vs Stamp Me](https://www.loyaltypass.co/blog/comparison/loyaltypass-vs-stamp-me)
- [German provider comparison (QARD)](https://getqard.com/vergleich/digitale-stempelkarte-anbieter) · [Stempely app comparison](https://stempely.de/stempelkarte-app-vergleich) · [Stempely DSGVO analysis](https://stempely.de/blog/digitale-stempelkarte-dsgvo)
- [Digital loyalty card apps compared (Kartle)](https://www.kartle.io/en/blog/best-digital-loyalty-card-apps) · [Favecard: free loyalty apps](https://www.favecard.co/en/blog/best-free-digital-loyalty-card-apps/)
