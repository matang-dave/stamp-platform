import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StaffSession } from './auth.service.js';

// Guarded requests carry the verified staff session; read it with @CurrentStaff().
export interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  staff?: StaffSession;
}

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('missing_token');
    }
    try {
      const payload = await this.jwt.verifyAsync<StaffSession>(token);
      req.staff = { staffId: payload.staffId, cafeId: payload.cafeId, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
  }
}
