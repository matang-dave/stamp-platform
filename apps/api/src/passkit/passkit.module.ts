import { Module } from '@nestjs/common';
import { PasskitController } from './passkit.controller.js';

@Module({
  controllers: [PasskitController],
})
export class PasskitModule {}
