# Apple Wallet manual smoke test (real iPhone)

> **Status: Pending — requires Apple Developer account + Pass Type ID certificate.**
> No Apple credentials were provisioned when T9 was built. All automated tests
> run with `AppleSigner`/`ApnsClient` mocked; this document is the manual
> verification to run once the human prerequisites from the plan exist.
> Until then the API runs in unconfigured mode: `GET /wallet/apple/:passId`
> answers `503 { "message": "wallet_not_configured" }` and APNs pushes are
> skipped (logged at debug level).

## What this verifies

The Wave 2 "done when": **enroll → pass lands in Apple Wallet → barista stamps
→ the pass updates on the phone** (via APNs push + PassKit web service).

## Prerequisites (human, one-time)

1. **Apple Developer Program** membership (the paid one).
2. **Pass Type ID** created in the developer portal, e.g.
   `pass.com.yourdomain.stamp`, with a certificate issued for it.
3. Export the Pass Type ID certificate **including its private key** from
   Keychain as `.p12`, then convert to one combined PEM:

   ```bash
   openssl pkcs12 -in pass.p12 -out certs/pass.pem -nodes -legacy
   ```

   (`certs/` is gitignored. Keep a passphrase? Then drop `-nodes` and set
   `APPLE_CERT_PASSWORD`.)
4. Download the **Apple WWDR G4 intermediate certificate**
   (https://www.apple.com/certificateauthority/) and convert to PEM:

   ```bash
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out certs/wwdr.pem
   ```
5. The API must be reachable from the phone over **HTTPS with a valid
   certificate** (Apple refuses plain http / self-signed for `webServiceURL`).
   For a test run, `ngrok http 3000` or a small cloud VM works.

## Environment

Add to `.env` (never commit it):

```ini
APPLE_TEAM_ID=ABCDE12345            # your 10-char team id
APPLE_PASS_TYPE_ID=pass.com.yourdomain.stamp
APPLE_CERT_PATH=certs/pass.pem
APPLE_CERT_PASSWORD=                # only if the key PEM is encrypted
APPLE_WWDR_PATH=certs/wwdr.pem      # default: certs/wwdr.pem
PUBLIC_BASE_URL=https://<public-host>   # becomes webServiceURL <base>/passkit
```

Restart the API. Configuration is detected at boot; with all of the above set
and both PEM files present, `isConfigured` flips on (503s disappear).

## Steps

1. **Seed** a café + owner/barista (or reuse dev seed). Note the café slug.
2. **Enroll on the iPhone:** open `https://<public-host>/c/<slug>` in Safari,
   choose *Apple Wallet*. The browser follows `addToWalletUrl`
   (`/wallet/apple/<passId>`) and downloads the `.pkpass`.
   - ✅ iOS shows the pass preview: café name, brand color, "Stamps 0 / 10",
     a QR code. Tap **Add**.
3. **Registration:** watch the API logs. Within seconds of adding, the device
   calls `POST /passkit/v1/devices/<id>/registrations/<passTypeId>/<passId>`.
   - ✅ Response 201; a row appears in `wallet_registrations`
     (`platform = 'apple'`, a long hex `push_token`).
   - If instead you see `POST /passkit/v1/log`, read the logged message —
     that's iOS telling you what it dislikes (usually cert/URL problems).
4. **Stamp:** log in as barista on another device (`/stamper`), scan the QR
   on the wallet pass, stamp once.
   - ✅ Scan is accepted (the pass barcode is the same signed payload).
   - ✅ API logs show an APNs push (200 from `api.push.apple.com`), then the
     device fetching `GET /passkit/v1/passes/<passTypeId>/<passId>`.
   - ✅ The pass on the phone now shows "Stamps 1 / 10" (pull the pass down
     to force-refresh if the push races the fetch).
5. **Voucher:** stamp until the café threshold; the *Free drinks* field on
   the pass increments. Redeem at the stamper; it decrements again.
6. **Unregister:** delete the pass from Wallet.
   - ✅ Device calls `DELETE /passkit/v1/devices/.../registrations/...`; the
     `wallet_registrations` row is gone.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| 503 `wallet_not_configured` | Missing env var or PEM file (check all five). |
| Pass downloads but iOS won't add it | Signature invalid: wrong WWDR cert (need G4), cert/key mismatch, or team/pass-type id doesn't match the certificate. |
| Pass added, no registration call | `webServiceURL` not https / not publicly reachable / self-signed. Check `POST /passkit/v1/log` output. |
| Stamp works, pass never updates | APNs error in API logs (`APNs 403` = cert not valid for push, `410` = token gone → user deleted pass). |

## Result log

| Date | Tester | Device / iOS | Result |
| --- | --- | --- | --- |
| — | — | — | Pending (no Apple credentials provisioned yet) |
