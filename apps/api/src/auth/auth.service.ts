import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { verifyPin } from './pin.js';

export interface LoginDto {
  cafeSlug: string;
  staffName: string;
  pin: string;
}

// What a signed staff JWT carries and what StaffGuard attaches to the request.
export interface StaffSession {
  staffId: string;
  cafeId: string;
  role: 'owner' | 'barista';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly jwt: JwtService,
  ) {}

  async login(body: LoginDto): Promise<StaffSession & { token: string }> {
    const [row] = await this.sql`
      select s.id, s.cafe_id, s.role, s.pin_hash
      from staff s
      join cafes c on c.id = s.cafe_id
      where c.slug = ${body.cafeSlug ?? ''}
        and s.name = ${body.staffName ?? ''}
        and s.status = 'active'
        and c.status = 'active'`;
    // Same 401 for unknown cafe/staff and wrong pin — don't leak which part failed.
    if (!row || !(await verifyPin(body.pin ?? '', row.pinHash as string))) {
      throw new UnauthorizedException('invalid_credentials');
    }
    const session: StaffSession = {
      staffId: row.id as string,
      cafeId: row.cafeId as string,
      role: row.role as StaffSession['role'],
    };
    return { ...session, token: await this.jwt.signAsync({ ...session }) };
  }
}
