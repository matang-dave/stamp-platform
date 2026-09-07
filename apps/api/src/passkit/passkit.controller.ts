import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppleWalletService } from '../wallet/apple/apple-wallet.service.js';

// Apple PassKit web service (the 5 endpoints iOS calls to keep passes fresh):
// https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes
// pass.json's webServiceURL points at `<base>/passkit`; the device appends
// `/v1/...`. Serial number == our pass UUID. All routes except the device's
// registration list and the log sink authenticate with the pass's
// authentication token (`Authorization: ApplePass <token>`).
@Controller('passkit/v1')
export class PasskitController {
  private readonly logger = new Logger(PasskitController.name);

  constructor(private readonly wallet: AppleWalletService) {}

  @Post('devices/:deviceId/registrations/:passTypeId/:serial')
  async register(
    @Param('deviceId') deviceId: string,
    @Param('serial') serial: string,
    @Body() body: { pushToken?: string },
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.wallet.authenticatePass(serial, authorization);
    if (!body?.pushToken || typeof body.pushToken !== 'string') {
      throw new BadRequestException('missing_push_token');
    }
    const created = await this.wallet.registerDevice(deviceId, serial, body.pushToken);
    res.status(created ? 201 : 200);
  }

  @Delete('devices/:deviceId/registrations/:passTypeId/:serial')
  @HttpCode(200)
  async unregister(
    @Param('deviceId') deviceId: string,
    @Param('serial') serial: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    await this.wallet.authenticatePass(serial, authorization);
    await this.wallet.unregisterDevice(deviceId, serial);
  }

  // Unauthenticated by spec: the device asks which of its passes changed.
  @Get('devices/:deviceId/registrations/:passTypeId')
  async updatablePasses(
    @Param('deviceId') deviceId: string,
    @Query('passesUpdatedSince') passesUpdatedSince: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ serialNumbers: string[]; lastUpdated: string } | undefined> {
    const updatable = await this.wallet.listUpdatablePasses(deviceId, passesUpdatedSince);
    if (!updatable) {
      res.status(204);
      return undefined;
    }
    return updatable;
  }

  @Get('passes/:passTypeId/:serial')
  async latestPass(
    @Param('serial') serial: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-modified-since') ifModifiedSince: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.wallet.authenticatePass(serial, authorization);
    const file = await this.wallet.latestPass(serial, ifModifiedSince);
    if (!file) {
      res.status(304).end();
      return;
    }
    res
      .status(200)
      .type('application/vnd.apple.pkpass')
      .setHeader('Last-Modified', file.lastModified.toUTCString())
      .send(file.buffer);
  }

  // Debug sink: devices POST error strings here; surface them in our logs.
  @Post('log')
  @HttpCode(200)
  log(@Body() body: { logs?: string[] }): Record<string, never> {
    for (const line of body?.logs ?? []) {
      this.logger.warn(`passkit device log: ${line}`);
    }
    return {};
  }
}
