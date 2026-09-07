import { Global, Module } from '@nestjs/common';
import { WALLET_PUSH } from '../stamper/wallet-push.port.js';
import { AppleWalletModule } from './apple/apple-wallet.module.js';
import { GoogleWalletModule } from './google/google-wallet.module.js';
import { WalletPushDispatcher } from './wallet-push.dispatcher.js';

// Binds the global WALLET_PUSH token to the composite dispatcher. @Global()
// (like DbModule/AuthModule) so StamperService's @Inject(WALLET_PUSH) resolves
// without StamperModule having to know about the wallet integrations.
@Global()
@Module({
  imports: [GoogleWalletModule, AppleWalletModule],
  providers: [
    WalletPushDispatcher,
    { provide: WALLET_PUSH, useExisting: WalletPushDispatcher },
  ],
  exports: [WALLET_PUSH],
})
export class WalletPushModule {}
