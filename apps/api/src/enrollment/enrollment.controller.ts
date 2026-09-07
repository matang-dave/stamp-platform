import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { EnrollRequest } from '@stamp/core';
import { z } from 'zod';
import { EnrollmentService } from './enrollment.service.js';

// Mirrors the frozen `EnrollRequest` contract from @stamp/core.
const enrollRequestSchema = z.object({
  platform: z.enum(['apple', 'google']),
  email: z.email().max(320).optional(),
  marketingConsent: z.boolean().optional(),
});

// Public routes (no StaffGuard): this is the customer-facing enrollment flow.
@Controller('c')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Get(':slug')
  getCafe(@Param('slug') slug: string) {
    return this.enrollment.getCafeBySlug(slug);
  }

  // Rate-limited (10/min/IP, configured in EnrollmentModule) — the only
  // unauthenticated write endpoint in the API.
  @UseGuards(ThrottlerGuard)
  @Post(':slug/enroll')
  enroll(@Param('slug') slug: string, @Body() body: unknown) {
    const parsed = enrollRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      );
    }
    return this.enrollment.enroll(slug, parsed.data satisfies EnrollRequest);
  }
}
