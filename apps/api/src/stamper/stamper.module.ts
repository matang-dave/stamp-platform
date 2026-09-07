import { Module } from '@nestjs/common';
import { StamperController } from './stamper.controller.js';
import { StamperService } from './stamper.service.js';

@Module({
  controllers: [StamperController],
  providers: [StamperService],
})
export class StamperModule {}
