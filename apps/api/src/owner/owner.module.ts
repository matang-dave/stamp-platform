import { Module } from '@nestjs/common';
import { AppleWalletModule } from '../wallet/apple/apple-wallet.module.js';
import { GoogleWalletModule } from '../wallet/google/google-wallet.module.js';
import { OwnerRoleGuard } from './owner-role.guard.js';
import { OwnerController } from './owner.controller.js';
import { OwnerService } from './owner.service.js';

// Owner mini-admin (T10). Imports both wallet modules so a broadcast can fan
// out to Google (message patch) and Apple (APNs push) passes; both no-op
// gracefully when the platform is not provisioned.
@Module({
  imports: [GoogleWalletModule, AppleWalletModule],
  controllers: [OwnerController],
  providers: [OwnerService, OwnerRoleGuard],
})
export class OwnerModule {}
