import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { StaffSession } from '../auth/auth.service.js';
import { CurrentStaff } from '../auth/current-staff.decorator.js';
import { StaffGuard } from '../auth/staff.guard.js';
import { StamperService } from './stamper.service.js';
import type { RedeemDto, ScanDto, StampDto } from './stamper.service.js';

// All stamper endpoints require an authenticated barista session (milestone 1).
// cafe_id is always derived from that session — never from the request body.
@UseGuards(StaffGuard)
@Controller('stamper')
export class StamperController {
  constructor(private readonly stamper: StamperService) {}

  @Post('scan')
  scan(@Body() body: ScanDto, @CurrentStaff() staff: StaffSession) {
    return this.stamper.scan(body, staff);
  }

  @Post('stamp')
  stamp(@Body() body: StampDto) {
    return this.stamper.stamp(body);
  }

  @Post('redeem')
  redeem(@Body() body: RedeemDto) {
    return this.stamper.redeem(body);
  }
}
