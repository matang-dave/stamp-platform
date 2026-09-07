import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CafePublicInfo, EnrollRequest, EnrollResponse } from '@stamp/core';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { PassesService } from '../passes/passes.service.js';

interface ActiveCafe {
  id: string;
  name: string;
  brandColor: string;
  stampsRequired: number;
}

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly passes: PassesService,
  ) {}

  async getCafeBySlug(slug: string): Promise<CafePublicInfo> {
    const cafe = await this.findActiveCafe(slug);
    return {
      name: cafe.name,
      brandColor: cafe.brandColor,
      stampsRequired: cafe.stampsRequired,
    };
  }

  async enroll(slug: string, body: EnrollRequest): Promise<EnrollResponse> {
    const cafe = await this.findActiveCafe(slug);
    const pass = await this.passes.createPass({
      cafeId: cafe.id,
      platform: body.platform,
      email: body.email,
      // Consent timestamp only on an explicit, unbundled opt-in (GDPR Art. 7).
      marketingConsent: body.marketingConsent,
    });
    await this.sql`
      insert into events (cafe_id, pass_id, action, detail)
      values (${cafe.id}, ${pass.id}, 'enroll', ${this.sql.json({
        platform: body.platform,
        emailProvided: body.email != null,
        marketingConsent: body.marketingConsent === true,
      })})`;
    return {
      passId: pass.id,
      // Stubbed 501 until Wave 2 (T8/T9) implements the wallet controllers;
      // the URL shape is part of the frozen contract.
      addToWalletUrl: `/wallet/${body.platform}/${pass.id}`,
    };
  }

  // Enrollment is public: unknown and disabled cafés are indistinguishable (404).
  private async findActiveCafe(slug: string): Promise<ActiveCafe> {
    const [cafe] = await this.sql`
      select id, name, brand_color, stamps_required
      from cafes
      where slug = ${slug} and status = 'active'`;
    if (!cafe) throw new NotFoundException('unknown_cafe');
    return cafe as unknown as ActiveCafe;
  }
}
