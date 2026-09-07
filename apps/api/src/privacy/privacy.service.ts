import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StaffSession } from '../auth/auth.service.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { erasePassesPii } from './erase-pii.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GDPR deletion path (T11). The owner-facing half; the operator CLI
// (scripts/delete-pass-data.ts) shares the erasure logic in erase-pii.ts.
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tenancy: TenancyService,
  ) {}

  /**
   * Erases a pass's PII (email + marketing consent), keeping the pass and
   * its already-anonymized events. Owner-role route; the pass must belong
   * to the session's café (403 otherwise). Idempotent.
   */
  async erasePassPii(passId: string, staff: StaffSession): Promise<{ erased: true }> {
    if (!UUID_RE.test(passId ?? '')) {
      throw new NotFoundException('unknown_pass');
    }
    const [pass] = await this.sql`select cafe_id from passes where id = ${passId}`;
    if (!pass) {
      throw new NotFoundException('unknown_pass');
    }
    this.tenancy.assertSameCafe(staff.cafeId, pass.cafeId as string);
    await erasePassesPii(this.sql, [passId], { staffId: staff.staffId, source: 'api' });
    return { erased: true };
  }
}
