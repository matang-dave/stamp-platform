import { Module } from '@nestjs/common';
import { PassesModule } from '../../passes/passes.module.js';
import { APNS_CLIENT, Http2ApnsClient, NoopApnsClient } from './apns.client.js';
import { ApplePassPush } from './apple-pass-push.js';
import { APPLE_SIGNER, PasskitGeneratorSigner, UnconfiguredAppleSigner } from './apple-signer.js';
import { AppleWalletConfig } from './apple-wallet.config.js';
import { AppleWalletController } from './apple-wallet.controller.js';
import { AppleWalletService } from './apple-wallet.service.js';

/**
 * Apple Wallet integration (T9): .pkpass download, PassKit web service
 * backing store, and APNs updates. Fully functional only with Apple
 * credentials in the env (see docs/wallet-apple-smoke-test.md); without them
 * the module boots fine, downloads answer 503 and pushes are skipped.
 *
 * ApplePassPush implements T4's WalletPushPort for apple passes. It is
 * exported but deliberately NOT bound to the global WALLET_PUSH token here:
 * the coordinator composes it with T8's Google implementation after merge.
 */
@Module({
  imports: [PassesModule],
  controllers: [AppleWalletController],
  providers: [
    AppleWalletConfig,
    AppleWalletService,
    ApplePassPush,
    {
      provide: APPLE_SIGNER,
      inject: [AppleWalletConfig],
      useFactory: (config: AppleWalletConfig) =>
        config.isConfigured ? new PasskitGeneratorSigner(config) : new UnconfiguredAppleSigner(),
    },
    {
      provide: APNS_CLIENT,
      inject: [AppleWalletConfig],
      useFactory: (config: AppleWalletConfig) =>
        config.isConfigured ? new Http2ApnsClient(config) : new NoopApnsClient(),
    },
  ],
  exports: [AppleWalletService, ApplePassPush],
})
export class AppleWalletModule {}
