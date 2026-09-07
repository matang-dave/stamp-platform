import { ForbiddenException, Injectable } from '@nestjs/common';

// Central multi-tenancy check. Every staff action on a pass/voucher/etc. must
// prove the resource belongs to the session's cafe before touching it — the
// cafe id always comes from the JWT session or the resource row, never from
// client input.
@Injectable()
export class TenancyService {
  assertSameCafe(sessionCafeId: string, resourceCafeId: string): void {
    if (sessionCafeId !== resourceCafeId) {
      throw new ForbiddenException('wrong_cafe');
    }
  }
}
