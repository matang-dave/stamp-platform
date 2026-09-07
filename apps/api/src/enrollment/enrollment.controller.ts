import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service.js';
import type { EnrollDto } from './enrollment.service.js';

@Controller('c')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Get(':slug')
  getCafe(@Param('slug') slug: string) {
    return this.enrollment.getCafeBySlug(slug);
  }

  @Post(':slug/enroll')
  enroll(@Param('slug') slug: string, @Body() body: EnrollDto) {
    return this.enrollment.enroll(slug, body);
  }
}
