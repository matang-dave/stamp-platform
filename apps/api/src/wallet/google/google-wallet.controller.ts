import { Controller, Get, Param, ParseUUIDPipe, Redirect, ServiceUnavailableException } from '@nestjs/common';
import { GoogleWalletService } from './google-wallet.service.js';

@Controller('wallet/google')
export class GoogleWalletController {
  constructor(private readonly googleWallet: GoogleWalletService) {}

  /**
   * "Add to Google Wallet" target from enrollment (T5 returns
   * `/wallet/google/<passId>` as addToWalletUrl). Redirects (302) to the
   * signed save link `https://pay.google.com/gp/v/save/<jwt>`.
   *
   * Without a provisioned issuer account (GOOGLE_WALLET_ISSUER_ID /
   * GOOGLE_APPLICATION_CREDENTIALS) this answers 503 wallet_not_configured.
   */
  @Get(':passId')
  @Redirect()
  async save(@Param('passId', ParseUUIDPipe) passId: string): Promise<{ url: string; statusCode: number }> {
    if (!this.googleWallet.configured) {
      throw new ServiceUnavailableException('wallet_not_configured');
    }
    return { url: await this.googleWallet.createSaveUrl(passId), statusCode: 302 };
  }
}
