# Google Wallet — manual smoke test (real Android phone)

> **Status: Pending — requires provisioned Google Wallet issuer account.**
> No Google credentials were available when T8 was built. All automated tests
> run against a mocked `GoogleWalletClient`; this document is the one manual
> check that must be executed once a human has provisioned the issuer account
> and service-account key. Until then, `GET /wallet/google/:passId` answers
> `503 wallet_not_configured` by design.

## Prerequisites (human, one-time)

1. A [Google Pay & Wallet Console](https://pay.google.com/business/console)
   account with the **Google Wallet API** enabled and an **Issuer ID**
   (a ~19-digit number shown in the console under *Google Wallet API*).
2. A Google Cloud **service account** with the *Wallet Object Issuer* role,
   added as a user in the Wallet console, and its **JSON key** downloaded.
3. While the issuer account is in demo mode, add the Google account used on
   the test phone as a **test user** in the console (otherwise saved passes
   show a "[TEST ONLY]" banner or saving is restricted to allow-listed users).
4. An Android phone with the **Google Wallet app** installed, signed in to
   that test Google account, with network access to the machine running the
   API (e.g. via a tunnel such as `ngrok`/`cloudflared`, or same LAN + the
   phone browser pointed at the machine's IP).

## Configure the API

1. Copy the service-account key to `certs/google-service-account.json`
   (the `certs/` directory is gitignored — never commit the key).
2. In `.env` set:

   ```dotenv
   GOOGLE_WALLET_ISSUER_ID=<your issuer id>
   GOOGLE_APPLICATION_CREDENTIALS=certs/google-service-account.json
   QR_SIGNING_SECRET=<same secret the stamper API uses>
   ```

3. Start Postgres, run migrations, create a tenant and start the API:

   ```bash
   npm run db:migrate
   npx tsx scripts/create-tenant.ts "Café Kranz" cafe-kranz   # prints owner PIN
   npm run dev:api
   ```

## Smoke test steps

### 1. Enroll and save the pass

1. On the phone, open the enrollment page `https://<host>/c/cafe-kranz`
   (or call the API directly: `POST /c/cafe-kranz/enroll` with body
   `{"platform":"google"}` — the response contains
   `addToWalletUrl: "/wallet/google/<passId>"`).
2. Open `https://<api-host>/wallet/google/<passId>` in the phone browser.
   - **Expect:** a 302 redirect to `https://pay.google.com/gp/v/save/<jwt>`
     and the Google "Add to Google Wallet" screen.
3. Tap **Add**.
   - **Expect:** a loyalty card "Café Kranz Stamp Card" appears in the
     Google Wallet app with the café's brand color, **Stamps: 0 / 10**,
     a "Vouchers" text section reading *"Collect all stamps to earn a free
     drink."*, and a QR code.
   - Server-side this lazily created the LoyaltyClass
     `<issuerId>.cafe_<cafeId>` (first enroll for the café only) and the
     LoyaltyObject `<issuerId>.pass_<passId>`.

### 2. Stamp at the counter and watch the pass update

1. On a second device (or desktop), open the stamper UI `/stamper`, log in
   with the barista PIN printed by `create-tenant`.
2. Scan the QR code shown on the phone's wallet pass.
   - **Expect:** the stamper shows the pass with 0 stamps and no warnings
     (the QR value is the HMAC-signed payload, so the scan must validate).
3. Tap **+1 stamp**.
4. On the phone, open the pass in Google Wallet (pull to refresh /
   reopen the card).
   - **Expect:** **Stamps: 1 / 10**. (`WalletPushPort.passChanged` PATCHed
     the loyalty object; Google Wallet refreshes the card from the object.)

### 3. Earn and redeem a voucher

1. Stamp the pass 9 more times (or once with the paper-card migration
   long-press adding the remainder).
   - **Expect on the phone:** **Stamps: 0 / 10** and the Vouchers section
     now reads *"1 free drink ready — show this pass at the counter."*
2. In the stamper UI, rescan the pass and tap **Redeem**.
   - **Expect on the phone:** the Vouchers section returns to
     *"Collect all stamps to earn a free drink."*

### 4. Re-save is idempotent

1. Open `https://<api-host>/wallet/google/<passId>` again and tap **Add**.
   - **Expect:** no duplicate card — the existing object is refreshed
     (PATCH), and Google Wallet still shows exactly one card with the
     current stamp count.

### 5. Failure modes (quick checks)

- `GET /wallet/google/<random-uuid>` → **404**.
- `GET /wallet/google/<passId-of-an-apple-pass>` → **400 not_a_google_pass**.
- Stop the API, remove `GOOGLE_WALLET_ISSUER_ID` from `.env`, restart:
  `GET /wallet/google/<passId>` → **503 wallet_not_configured**; stamping
  still works (wallet push silently no-ops).

## Sign-off

| Check | Result | Tester | Date |
|---|---|---|---|
| Save link adds pass on real Android phone | ☐ | | |
| Stamp updates pass (loyaltyPoints) | ☐ | | |
| Voucher earn/redeem reflected in text module | ☐ | | |
| Re-save idempotent (no duplicate card) | ☐ | | |
| Failure modes (404 / 400 / 503) | ☐ | | |
