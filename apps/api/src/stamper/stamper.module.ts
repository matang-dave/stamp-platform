import { Module } from '@nestjs/common';
import { StamperController } from './stamper.controller.js';
import { StamperService } from './stamper.service.js';
import { NoopWalletPush, WALLET_PUSH } from './wallet-push.port.js';

@Module({
  controllers: [StamperController],
  providers: [
    StamperService,
    // No-op default; T8 (Apple) / T9 (Google) rebind WALLET_PUSH to real
    // wallet push implementations.
    { provide: WALLET_PUSH, useClass: NoopWalletPush },
  ],
  exports: [WALLET_PUSH],
})
export class StamperModule {}
