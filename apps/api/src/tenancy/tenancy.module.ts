import { Global, Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service.js';

// Global (like DbModule): every feature module that touches tenant-owned rows
// needs TenancyService, so it is available everywhere without explicit imports.
@Global()
@Module({
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
