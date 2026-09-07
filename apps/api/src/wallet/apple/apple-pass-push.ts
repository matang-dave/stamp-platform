import { Inject, Injectable, Logger } from '@nestjs/common';
import { SQL } from '../../db/db.provider.js';
import type { Sql } from '../../db/db.provider.js';
import type { WalletPushPort } from '../../stamper/wallet-push.port.js';
import { APNS_CLIENT } from './apns.client.js';
import type { ApnsClient } from './apns.client.js';
import { AppleWalletConfig } from './apple-wallet.config.js';

/**
 * Apple half of the WalletPushPort (T4's outbound port): on passChanged,
 * push the empty PassKit notification to every device registered for the
 * pass. No-ops for non-apple passes — the coordinator wires a composite
 * dispatcher over this and T8's Google implementation at merge time, so this
 * class does NOT rebind the global WALLET_PUSH token itself.
 */
@Injectable()
export class ApplePassPush implements WalletPushPort {
  private readonly logger = new Logger(ApplePassPush.name);

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly config: AppleWalletConfig,
    @Inject(APNS_CLIENT) private readonly apns: ApnsClient,
  ) {}

  async passChanged(passId: string): Promise<void> {
    const registrations = await this.sql`
      select r.push_token
      from wallet_registrations r
      join passes p on p.id = r.pass_id
      where r.pass_id = ${passId} and r.platform = 'apple' and p.platform = 'apple'`;
    for (const { pushToken } of registrations) {
      try {
        await this.apns.pushPassUpdate(pushToken as string, this.config.passTypeId);
      } catch (err) {
        // A dead push token must never fail the stamp/redeem that triggered it.
        this.logger.warn(`APNs push failed for pass ${passId}: ${(err as Error).message}`);
      }
    }
  }
}
