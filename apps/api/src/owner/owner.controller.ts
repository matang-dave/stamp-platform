import { Body, Controller, Get, Post } from '@nestjs/common';
import { OwnerService } from './owner.service.js';
import type { BroadcastDto } from './owner.service.js';

// Owner-role endpoints, scoped to the owner's cafe (milestone 6).
@Controller('owner')
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Get('stats')
  stats() {
    return this.owner.stats();
  }

  @Post('broadcast')
  broadcast(@Body() body: BroadcastDto) {
    return this.owner.broadcast(body);
  }
}
