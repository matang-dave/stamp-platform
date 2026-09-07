import { Module } from '@nestjs/common';
import { AppleWalletModule } from '../wallet/apple/apple-wallet.module.js';
import { PasskitController } from './passkit.controller.js';

@Module({
  imports: [AppleWalletModule],
  controllers: [PasskitController],
})
export class PasskitModule {}
