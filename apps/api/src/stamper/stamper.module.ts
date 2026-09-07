import { Module } from '@nestjs/common';
import { StamperController } from './stamper.controller.js';
import { StamperService } from './stamper.service.js';

// WALLET_PUSH is bound globally by WalletPushModule (composite Google+Apple
// dispatcher); StamperService injects the token directly.
@Module({
  controllers: [StamperController],
  providers: [StamperService],
})
export class StamperModule {}
