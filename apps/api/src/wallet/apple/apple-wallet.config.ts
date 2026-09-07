import { existsSync } from 'node:fs';
import { Injectable } from '@nestjs/common';

/**
 * Apple Wallet configuration, read from the environment once at boot.
 *
 * No credentials provisioned (the default in dev/CI) is a supported mode:
 * `isConfigured` is false, `.pkpass` downloads answer 503 wallet_not_configured
 * and APNs pushes are skipped. See docs/wallet-apple-smoke-test.md for the
 * full list of env vars a real deployment needs.
 */
@Injectable()
export class AppleWalletConfig {
  /** Apple Developer Team ID (pass.json `teamIdentifier`). */
  readonly teamId = process.env.APPLE_TEAM_ID ?? '';
  /** Pass Type ID (pass.json `passTypeIdentifier`, also the APNs topic). */
  readonly passTypeId = process.env.APPLE_PASS_TYPE_ID ?? '';
  /** PEM with the Pass Type ID certificate AND its private key (combined). */
  readonly certPath = process.env.APPLE_CERT_PATH ?? 'certs/pass.pem';
  readonly certPassword = process.env.APPLE_CERT_PASSWORD ?? '';
  /** Apple WWDR G4 intermediate certificate (PEM). */
  readonly wwdrPath = process.env.APPLE_WWDR_PATH ?? 'certs/wwdr.pem';
  /**
   * Public https base URL of this API. The device calls
   * `<webServiceUrl>/v1/...`, which our PasskitController serves under
   * `/passkit/v1/...` — hence the `/passkit` suffix.
   */
  readonly webServiceUrl = `${
    process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  }/passkit`;
  /** Same HMAC secret the stamper uses to verify scanned QR payloads. */
  readonly qrSigningSecret = process.env.QR_SIGNING_SECRET ?? '';

  get isConfigured(): boolean {
    return Boolean(
      this.teamId &&
        this.passTypeId &&
        this.qrSigningSecret &&
        existsSync(this.certPath) &&
        existsSync(this.wwdrPath),
    );
  }
}
