import { readFile } from 'node:fs/promises';
import { ServiceUnavailableException } from '@nestjs/common';
import { PKPass } from 'passkit-generator';
import { AppleWalletConfig } from './apple-wallet.config.js';
import type { ApplePassJson } from './pass-json.js';
import { solidPng } from './placeholder-icon.js';

export const APPLE_SIGNER = Symbol('APPLE_SIGNER');

/**
 * Renders and signs a complete .pkpass bundle. Kept behind an interface so
 * unit/integration tests run with a fake — no Apple certificates needed.
 */
export interface AppleSigner {
  createPkpass(passJson: ApplePassJson): Promise<Buffer>;
}

/** Real signer: passkit-generator + the Pass Type ID cert from disk. */
export class PasskitGeneratorSigner implements AppleSigner {
  private certs?: { wwdr: Buffer; signerPem: Buffer };

  constructor(private readonly config: AppleWalletConfig) {}

  async createPkpass(passJson: ApplePassJson): Promise<Buffer> {
    this.certs ??= {
      // APPLE_CERT_PATH is one PEM holding both the certificate and its
      // private key; node-forge picks the matching block from each.
      signerPem: await readFile(this.config.certPath),
      wwdr: await readFile(this.config.wwdrPath),
    };
    // Icon in the café's brand color (parsed back out of "rgb(r, g, b)").
    const [r = 0, g = 0, b = 0] = (passJson.backgroundColor.match(/\d+/g) ?? []).map(Number);
    const pass = new PKPass(
      {
        'pass.json': Buffer.from(JSON.stringify(passJson)),
        'icon.png': solidPng(29, r, g, b),
        'icon@2x.png': solidPng(58, r, g, b),
        'logo.png': solidPng(50, r, g, b),
      },
      {
        wwdr: this.certs.wwdr,
        signerCert: this.certs.signerPem,
        signerKey: this.certs.signerPem,
        signerKeyPassphrase: this.config.certPassword || undefined,
      },
    );
    return pass.getAsBuffer();
  }
}

/** Bound when APPLE_* env/cert files are absent — dev, CI, pre-launch prod. */
export class UnconfiguredAppleSigner implements AppleSigner {
  async createPkpass(): Promise<Buffer> {
    throw new ServiceUnavailableException('wallet_not_configured');
  }
}
