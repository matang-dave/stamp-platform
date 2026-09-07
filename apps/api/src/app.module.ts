import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DbModule } from './db/db.module.js';
import { EnrollmentModule } from './enrollment/enrollment.module.js';
import { OwnerModule } from './owner/owner.module.js';
import { PasskitModule } from './passkit/passkit.module.js';
import { StamperModule } from './stamper/stamper.module.js';

@Module({
  imports: [DbModule, EnrollmentModule, StamperModule, OwnerModule, PasskitModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
