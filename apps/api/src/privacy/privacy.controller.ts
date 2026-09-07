import { Controller, Delete, Param, UseGuards } from '@nestjs/common';
import type { StaffSession } from '../auth/auth.service.js';
import { CurrentStaff } from '../auth/current-staff.decorator.js';
import { StaffGuard } from '../auth/staff.guard.js';
import { OwnerRoleGuard } from '../owner/owner-role.guard.js';
import { PrivacyService } from './privacy.service.js';

// Lives under the /owner prefix (it is an owner-role action) but is owned by
// the privacy module: GDPR erasure of a single pass's PII.
@UseGuards(StaffGuard, OwnerRoleGuard)
@Controller('owner')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Delete('pass/:id/pii')
  erasePassPii(@Param('id') id: string, @CurrentStaff() staff: StaffSession) {
    return this.privacy.erasePassPii(id, staff);
  }
}
