import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { StaffSession } from './auth.service.js';
import type { AuthenticatedRequest } from './staff.guard.js';

// Exposes the StaffSession attached by StaffGuard. Only meaningful on routes
// guarded with @UseGuards(StaffGuard).
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffSession => {
    const staff = ctx.switchToHttp().getRequest<AuthenticatedRequest>().staff;
    if (!staff) {
      throw new Error('CurrentStaff used on a route without StaffGuard');
    }
    return staff;
  },
);
