import { Module } from '@nestjs/common';
import { OwnerRoleGuard } from '../owner/owner-role.guard.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

// GDPR deletion path (T11): DELETE /owner/pass/:id/pii. The equivalent
// operator CLI is scripts/delete-pass-data.ts (same erase-pii.ts logic).
@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService, OwnerRoleGuard],
})
export class PrivacyModule {}
