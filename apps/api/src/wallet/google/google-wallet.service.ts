import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { PassSummary } from '@stamp/core';
import { encodeQrPayload } from '@stamp/core';
import { PassesService } from '../../passes/passes.service.js';
import type { PassCafeInfo, PassRecord } from '../../passes/passes.service.js';
import {
  GOOGLE_WALLET_CLIENT,
  GOOGLE_WALLET_CONFIG,
} from './google-wallet-client.js';
import type {
  GoogleWalletClient,
  GoogleWalletConfig,
  LoyaltyClassPayload,
  LoyaltyObjectPayload,
  LoyaltyPoints,
  TextModule,
} from './google-wallet-client.js';

export const GOOGLE_SAVE_URL_BASE = 'https://pay.google.com/gp/v/save';

@Injectable()
export class GoogleWalletService {
  private readonly logger = new Logger(GoogleWalletService.name);
  // Class ids known to exist upstream — avoids a GET per save-link request.
  private readonly ensuredClasses = new Set<string>();

  constructor(
    private readonly passes: PassesService,
    @Optional() @Inject(GOOGLE_WALLET_CONFIG) private readonly config: GoogleWalletConfig | null,
    @Optional() @Inject(GOOGLE_WALLET_CLIENT) private readonly client: GoogleWalletClient | null,
  ) {}

  /** false when GOOGLE_WALLET_ISSUER_ID / GOOGLE_APPLICATION_CREDENTIALS are absent. */
  get configured(): boolean {
    return this.config !== null && this.client !== null;
  }

  /**
   * Ensures the café's LoyaltyClass and the pass's LoyaltyObject exist (class
   * created lazily on first enroll, object inserted or refreshed), then
   * returns the signed `https://pay.google.com/gp/v/save/<jwt>` link.
   */
  async createSaveUrl(passId: string): Promise<string> {
    const found = await this.passes.findWithCafe(passId);
    if (!found) throw new NotFoundException('unknown_pass');
    if (found.pass.platform !== 'google') throw new BadRequestException('not_a_google_pass');
    const summary = (await this.passes.getSummary(passId))!;

    const classId = await this.ensureClass(found.cafe);
    const object = this.buildObject(found.pass, found.cafe, summary, classId);
    if (await this.client!.getObject(object.id)) {
      await this.client!.patchObject(object.id, this.statePatch(summary));
    } else {
      await this.client!.insertObject(object);
    }

    const jwt = await this.client!.signSaveJwt({
      payload: { loyaltyObjects: [{ id: object.id, classId }] },
      origins: [],
    });
    return `${GOOGLE_SAVE_URL_BASE}/${jwt}`;
  }

  /**
   * WalletPushPort backend for google-platform passes: PATCH the loyalty
   * object with the current stamp/voucher state. No-op when unconfigured,
   * when the pass is unknown, or when it is not a Google pass. Push failures
   * (e.g. the customer never saved the pass, so the object does not exist)
   * are logged, never thrown — a wallet refresh must not break stamping.
   */
  async pushUpdate(passId: string): Promise<void> {
    if (!this.configured) return;
    const found = await this.passes.findWithCafe(passId);
    if (!found || found.pass.platform !== 'google') return;
    const summary = await this.passes.getSummary(passId);
    if (!summary) return;
    try {
      await this.client!.patchObject(this.objectId(passId), this.statePatch(summary));
    } catch (err) {
      this.logger.warn(`google wallet patch failed for pass ${passId}: ${String(err)}`);
    }
  }

  /**
   * Owner broadcast backend (additive T10 extension): patch the broadcast
   * message onto the pass's loyalty object so Google Wallet notifies the
   * user. Same failure contract as pushUpdate — no-op when unconfigured /
   * not a google pass, log-and-swallow when the object was never saved.
   */
  async pushMessage(passId: string, message: string): Promise<void> {
    if (!this.configured) return;
    const found = await this.passes.findWithCafe(passId);
    if (!found || found.pass.platform !== 'google') return;
    try {
      await this.client!.patchObject(this.objectId(passId), {
        messages: [{ id: 'broadcast', header: found.cafe.name, body: message }],
      });
    } catch (err) {
      this.logger.warn(`google wallet broadcast failed for pass ${passId}: ${String(err)}`);
    }
  }

  // --- id helpers ------------------------------------------------------------

  classId(cafeId: string): string {
    return `${this.config!.issuerId}.cafe_${cafeId}`;
  }

  objectId(passId: string): string {
    return `${this.config!.issuerId}.pass_${passId}`;
  }

  // --- payload builders ------------------------------------------------------

  /** One LoyaltyClass per café, created lazily on the first save-link request. */
  private async ensureClass(cafe: PassCafeInfo): Promise<string> {
    const id = this.classId(cafe.id);
    if (this.ensuredClasses.has(id)) return id;
    if (!(await this.client!.getClass(id))) {
      await this.client!.insertClass(this.buildClass(cafe, id));
    }
    this.ensuredClasses.add(id);
    return id;
  }

  private buildClass(cafe: PassCafeInfo, id: string): LoyaltyClassPayload {
    return {
      id,
      issuerName: cafe.name,
      programName: `${cafe.name} Stamp Card`,
      reviewStatus: 'UNDER_REVIEW',
      hexBackgroundColor: cafe.brandColor,
      ...(cafe.logoUrl ? { programLogo: { sourceUri: { uri: cafe.logoUrl } } } : {}),
    };
  }

  private buildObject(
    pass: PassRecord,
    cafe: PassCafeInfo,
    summary: PassSummary,
    classId: string,
  ): LoyaltyObjectPayload {
    const secret = process.env.QR_SIGNING_SECRET;
    if (!secret) throw new Error('QR_SIGNING_SECRET is not set');
    return {
      id: this.objectId(pass.id),
      classId,
      state: 'ACTIVE',
      loyaltyPoints: this.loyaltyPoints(summary),
      textModulesData: [this.voucherModule(summary)],
      // The barista scans this QR at the counter — same signed payload the
      // stamper API verifies (@stamp/core).
      barcode: { type: 'QR_CODE', value: encodeQrPayload(pass.id, secret), alternateText: cafe.name },
    };
  }

  /** The mutable slice PATCHed on every stamp/redeem. */
  private statePatch(summary: PassSummary): Partial<LoyaltyObjectPayload> {
    return {
      loyaltyPoints: this.loyaltyPoints(summary),
      textModulesData: [this.voucherModule(summary)],
    };
  }

  private loyaltyPoints(summary: PassSummary): LoyaltyPoints {
    return { label: 'Stamps', balance: { string: `${summary.stamps} / ${summary.stampsRequired}` } };
  }

  private voucherModule(summary: PassSummary): TextModule {
    const n = summary.vouchersAvailable;
    return {
      id: 'vouchers',
      header: 'Vouchers',
      body:
        n > 0
          ? `${n} free drink${n === 1 ? '' : 's'} ready — show this pass at the counter.`
          : 'Collect all stamps to earn a free drink.',
    };
  }
}
