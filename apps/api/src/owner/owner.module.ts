import { Module } from '@nestjs/common';
import { OwnerController } from './owner.controller.js';
import { OwnerService } from './owner.service.js';

@Module({
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
