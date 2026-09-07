import { Inject, Injectable } from '@nestjs/common';
import type { PassSummary } from '@stamp/core';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';

export type WalletPlatform = 'apple' | 'google';

export interface PassRecord {
  id: string;
  cafeId: string;
  platform: WalletPlatform;
  stamps: number;
  email: string | null;
  marketingConsentAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/** Café branding/config a wallet pass needs to render itself (T8/T9). */
export interface PassCafeInfo {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  logoUrl: string | null;
  stampsRequired: number;
  status: 'active' | 'disabled';
}

export interface CreatePassInput {
  cafeId: string;
  platform: WalletPlatform;
  email?: string;
  /**
   * GDPR Art. 7 — unbundled opt-in. The consent timestamp is written only on
   * an explicit `true`; absent/false/anything-else leaves it null.
   */
  marketingConsent?: boolean;
}

/**
 * Pass CRUD shared between enrollment (T5) and the wallet integrations
 * (T8 Google / T9 Apple), which import PassesModule.
 */
@Injectable()
export class PassesService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async createPass(input: CreatePassInput): Promise<PassRecord> {
    const [pass] = await this.sql`
      insert into passes (cafe_id, platform, email, marketing_consent_at)
      values (
        ${input.cafeId},
        ${input.platform},
        ${input.email ?? null},
        ${input.marketingConsent === true ? this.sql`now()` : null}
      )
      returning *`;
    return pass as unknown as PassRecord;
  }

  async findById(passId: string): Promise<PassRecord | null> {
    const [pass] = await this.sql`select * from passes where id = ${passId}`;
    return (pass as unknown as PassRecord) ?? null;
  }

  /** Pass plus the café branding a wallet integration needs to render it. */
  async findWithCafe(passId: string): Promise<{ pass: PassRecord; cafe: PassCafeInfo } | null> {
    const pass = await this.findById(passId);
    if (!pass) return null;
    const [cafe] = await this.sql`
      select id, name, slug, brand_color, logo_url, stamps_required, status
      from cafes where id = ${pass.cafeId}`;
    return { pass, cafe: cafe as unknown as PassCafeInfo };
  }

  /** Contract-shaped summary (stamps, vouchers, last stamp) for a pass. */
  async getSummary(passId: string): Promise<PassSummary | null> {
    const [row] = await this.sql`
      select
        p.id,
        p.stamps,
        c.stamps_required,
        (select count(*)::int from vouchers v
          where v.pass_id = p.id
            and v.redeemed_at is null
            and (v.expires_at is null or v.expires_at > now())) as vouchers_available,
        (select max(e.created_at) from events e
          where e.pass_id = p.id and e.action in ('stamp', 'stamp_bulk')) as last_stamp_at
      from passes p
      join cafes c on c.id = p.cafe_id
      where p.id = ${passId}`;
    if (!row) return null;
    return {
      passId: row.id as string,
      stamps: row.stamps as number,
      stampsRequired: row.stampsRequired as number,
      vouchersAvailable: row.vouchersAvailable as number,
      lastStampAt: row.lastStampAt ? (row.lastStampAt as Date).toISOString() : null,
    };
  }
}
