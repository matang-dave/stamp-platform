import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppleWalletService } from './apple-wallet.service.js';

/**
 * Public .pkpass download — the `addToWalletUrl` the enrollment flow (T5)
 * hands out for apple-platform passes. Possession of the unguessable pass
 * UUID is the credential (same model as the QR payload); without Apple
 * credentials on the server it answers 503 wallet_not_configured.
 */
@Controller('wallet/apple')
export class AppleWalletController {
  constructor(private readonly wallet: AppleWalletService) {}

  @Get(':passId')
  async download(@Param('passId') passId: string, @Res() res: Response): Promise<void> {
    const file = await this.wallet.buildPkpass(passId);
    res
      .status(200)
      .type('application/vnd.apple.pkpass')
      .setHeader('Content-Disposition', 'attachment; filename="stamp-card.pkpass"')
      .setHeader('Last-Modified', file.lastModified.toUTCString())
      .send(file.buffer);
  }
}
