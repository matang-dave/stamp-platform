import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PassesModule } from '../passes/passes.module.js';
import { EnrollmentController } from './enrollment.controller.js';
import { EnrollmentService } from './enrollment.service.js';

@Module({
  imports: [
    PassesModule,
    // Registered here (not in app.module) so the limit backs only this
    // module's public enroll endpoint; the guard is applied per-route in
    // EnrollmentController. 10 requests / 60s / IP.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [EnrollmentController],
  providers: [EnrollmentService],
})
export class EnrollmentModule {}
