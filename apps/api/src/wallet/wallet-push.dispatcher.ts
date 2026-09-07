import { Injectable } from '@nestjs/common';
import type { WalletPushPort } from '../stamper/wallet-push.port.js';
import { ApplePassPush } from './apple/apple-pass-push.js';
import { GoogleWalletPush } from './google/google-wallet.push.js';

// Composite WalletPushPort (coordinator glue between T4/T8/T9): fans a pass
// change out to both platform implementations. Each one self-filters by the
// pass's platform and swallows its own delivery failures, so a stamp/redeem
// mutation never fails because a wallet push did.
@Injectable()
export class WalletPushDispatcher implements WalletPushPort {
  constructor(
    private readonly google: GoogleWalletPush,
    private readonly apple: ApplePassPush,
  ) {}

  async passChanged(passId: string): Promise<void> {
    await Promise.all([this.google.passChanged(passId), this.apple.passChanged(passId)]);
  }
}
