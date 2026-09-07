import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { BroadcastRequest } from '@stamp/core';
import { z } from 'zod';
import type { StaffSession } from '../auth/auth.service.js';
import { CurrentStaff } from '../auth/current-staff.decorator.js';
import { StaffGuard } from '../auth/staff.guard.js';
import { OwnerRoleGuard } from './owner-role.guard.js';
import { OwnerService } from './owner.service.js';

// Server-side mirror of the frozen BroadcastRequest contract: <= 140 chars.
const broadcastSchema = z.object({
  message: z.string().trim().min(1).max(140),
});

const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// Owner mini-admin (milestone 6). Every route requires an authenticated staff
// session with role 'owner'; all data is scoped to the session's café.
@UseGuards(StaffGuard, OwnerRoleGuard)
@Controller('owner')
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Get('stats')
  stats(@CurrentStaff() staff: StaffSession) {
    return this.owner.stats(staff);
  }

  @Post('broadcast')
  broadcast(@Body() body: unknown, @CurrentStaff() staff: StaffSession) {
    const parsed = broadcastSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('message must be 1-140 characters');
    }
    return this.owner.broadcast(staff, (parsed.data satisfies BroadcastRequest).message);
  }

  @Get('staff')
  listStaff(@CurrentStaff() staff: StaffSession) {
    return this.owner.listStaff(staff);
  }

  @Post('staff')
  createStaff(@Body() body: unknown, @CurrentStaff() staff: StaffSession) {
    const parsed = createStaffSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('name must be 1-100 characters');
    }
    return this.owner.createStaff(staff, parsed.data.name);
  }

  @Delete('staff/:id')
  disableStaff(@Param('id') id: string, @CurrentStaff() staff: StaffSession) {
    return this.owner.disableStaff(staff, id);
  }
}
