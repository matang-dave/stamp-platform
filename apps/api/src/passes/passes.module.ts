import { Module } from '@nestjs/common';
import { PassesService } from './passes.service.js';

// Imported by EnrollmentModule (T5) and the wallet modules (T8/T9).
@Module({
  providers: [PassesService],
  exports: [PassesService],
})
export class PassesModule {}
