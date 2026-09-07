import { Injectable } from '@nestjs/common';
import type { WalletPushPort } from '../../stamper/wallet-push.port.js';
import { GoogleWalletService } from './google-wallet.service.js';

/**
 * WalletPushPort implementation for Google Wallet (T8).
 *
 * Deliberately NOT bound to the global WALLET_PUSH token here: T9 provides
 * the Apple implementation of the same port in parallel, and the coordinator
 * wires a composite dispatcher over both at merge time. This class is
 * injectable and exported by GoogleWalletModule for exactly that composition.
 *
 * passChanged PATCHes the loyalty object for google-platform passes and
 * no-ops for everything else (apple passes, unknown ids, unconfigured env).
 */
@Injectable()
export class GoogleWalletPush implements WalletPushPort {
  constructor(private readonly googleWallet: GoogleWalletService) {}

  async passChanged(passId: string): Promise<void> {
    await this.googleWallet.pushUpdate(passId);
  }
}
