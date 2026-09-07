import { Module } from '@nestjs/common';
import { PassesModule } from '../../passes/passes.module.js';
import {
  GOOGLE_WALLET_CLIENT,
  GOOGLE_WALLET_CONFIG,
  loadGoogleWalletConfig,
} from './google-wallet-client.js';
import type { GoogleWalletConfig } from './google-wallet-client.js';
import { GoogleWalletController } from './google-wallet.controller.js';
import { GoogleWalletPush } from './google-wallet.push.js';
import { GoogleWalletService } from './google-wallet.service.js';
import { HttpGoogleWalletClient } from './http-google-wallet.client.js';

@Module({
  imports: [PassesModule],
  controllers: [GoogleWalletController],
  providers: [
    // Both factories resolve to null when Google Wallet is not provisioned;
    // the controller then serves 503 wallet_not_configured and GoogleWalletPush
    // no-ops. Tests override these two tokens with a fixed config + fake client.
    { provide: GOOGLE_WALLET_CONFIG, useFactory: () => loadGoogleWalletConfig() },
    {
      provide: GOOGLE_WALLET_CLIENT,
      useFactory: (config: GoogleWalletConfig | null) =>
        config ? new HttpGoogleWalletClient(config) : null,
      inject: [GOOGLE_WALLET_CONFIG],
    },
    GoogleWalletService,
    GoogleWalletPush,
  ],
  // GoogleWalletPush implements WalletPushPort (T4). It is exported — not
  // bound to the global WALLET_PUSH token — so the coordinator can compose it
  // with T9's Apple implementation in one dispatcher at merge time.
  // GoogleWalletService is exported for the owner broadcast (T10 pushMessage).
  exports: [GoogleWalletPush, GoogleWalletService],
})
export class GoogleWalletModule {}
