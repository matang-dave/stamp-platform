import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/staff.guard.js';

/**
 * Requires the staff session attached by StaffGuard to carry the 'owner'
 * role. Always list it AFTER StaffGuard: @UseGuards(StaffGuard, OwnerRoleGuard).
 * Baristas get 403 on every owner route.
 */
@Injectable()
export class OwnerRoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const staff = ctx.switchToHttp().getRequest<AuthenticatedRequest>().staff;
    if (staff?.role !== 'owner') {
      throw new ForbiddenException('owner_only');
    }
    return true;
  }
}
