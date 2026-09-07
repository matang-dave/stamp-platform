import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SQL } from '../../db/db.provider.js';
import type { Sql } from '../../db/db.provider.js';
import { PassesService } from '../../passes/passes.service.js';
import { APPLE_SIGNER } from './apple-signer.js';
import type { AppleSigner } from './apple-signer.js';
import { AppleWalletConfig } from './apple-wallet.config.js';
import { buildPassJson } from './pass-json.js';

export interface PkpassFile {
  buffer: Buffer;
  /** For the Last-Modified header / 304 handling on web-service fetches. */
  lastModified: Date;
}

export interface UpdatablePasses {
  serialNumbers: string[];
  /** Opaque change tag the device echoes back as ?passesUpdatedSince=. */
  lastUpdated: string;
}

@Injectable()
export class AppleWalletService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly passes: PassesService,
    private readonly config: AppleWalletConfig,
    @Inject(APPLE_SIGNER) private readonly signer: AppleSigner,
  ) {}

  /** Renders + signs the current .pkpass for an apple-platform pass. */
  async buildPkpass(passId: string): Promise<PkpassFile> {
    if (!this.config.isConfigured) {
      throw new ServiceUnavailableException('wallet_not_configured');
    }
    const found = await this.passes.findWithCafe(passId);
    if (!found || found.pass.platform !== 'apple') {
      throw new NotFoundException('unknown_pass');
    }
    const summary = await this.passes.getSummary(passId);
    if (!summary) throw new NotFoundException('unknown_pass');
    const buffer = await this.signer.createPkpass(
      buildPassJson({
        passId,
        cafe: found.cafe,
        summary,
        authenticationToken: await this.ensureAuthToken(passId),
        teamId: this.config.teamId,
        passTypeId: this.config.passTypeId,
        webServiceUrl: this.config.webServiceUrl,
        qrSigningSecret: this.config.qrSigningSecret,
      }),
    );
    return { buffer, lastModified: await this.lastUpdatedAt(passId) };
  }

  /**
   * Web-service auth: `Authorization: ApplePass <token>` must match the
   * token embedded in the pass (passes.apple_auth_token). 401 on any
   * mismatch — including unknown serials, so serials can't be enumerated.
   */
  async authenticatePass(serial: string, authorization: string | undefined): Promise<void> {
    const given = /^ApplePass (.+)$/.exec(authorization ?? '')?.[1];
    if (!given) throw new UnauthorizedException();
    const [row] = UUID_RE.test(serial)
      ? await this.sql`
          select apple_auth_token from passes
          where id = ${serial} and platform = 'apple'`
      : [];
    const expected: string | null = row?.appleAuthToken ?? null;
    if (!expected || !constantTimeEquals(given, expected)) {
      throw new UnauthorizedException();
    }
  }

  /** POST register: true = newly registered (201), false = already was (200). */
  async registerDevice(deviceId: string, serial: string, pushToken: string): Promise<boolean> {
    const rows = await this.sql`
      insert into wallet_registrations (pass_id, platform, device_id, push_token)
      values (${serial}, 'apple', ${deviceId}, ${pushToken})
      on conflict (pass_id, device_id)
        do update set push_token = ${pushToken}
      returning (xmax = 0) as created`;
    return rows[0]?.created === true;
  }

  async unregisterDevice(deviceId: string, serial: string): Promise<void> {
    await this.sql`
      delete from wallet_registrations
      where pass_id = ${serial} and device_id = ${deviceId} and platform = 'apple'`;
  }

  /**
   * Serials of this device's passes changed since the (ms-epoch) tag.
   * Null means "nothing to report" → HTTP 204.
   */
  async listUpdatablePasses(deviceId: string, updatedSince?: string): Promise<UpdatablePasses | null> {
    const rows = await this.sql`
      select p.id, greatest(p.created_at, max(e.created_at)) as updated_at
      from wallet_registrations r
      join passes p on p.id = r.pass_id
      left join events e on e.pass_id = p.id
      where r.device_id = ${deviceId} and r.platform = 'apple'
      group by p.id, p.created_at`;
    const since = updatedSince ? Number(updatedSince) : Number.NEGATIVE_INFINITY;
    const changed = rows
      .map((r) => ({ id: r.id as string, updatedMs: (r.updatedAt as Date).getTime() }))
      .filter((r) => r.updatedMs > since);
    if (changed.length === 0) return null;
    return {
      serialNumbers: changed.map((r) => r.id),
      lastUpdated: String(Math.max(...changed.map((r) => r.updatedMs))),
    };
  }

  /** GET latest pass; null = not modified since ifModifiedSince (→ 304). */
  async latestPass(serial: string, ifModifiedSince?: string): Promise<PkpassFile | null> {
    if (ifModifiedSince) {
      const sinceMs = Date.parse(ifModifiedSince);
      const updated = await this.lastUpdatedAt(serial);
      // HTTP dates have second granularity; compare on whole seconds.
      if (!Number.isNaN(sinceMs) && Math.floor(updated.getTime() / 1000) <= sinceMs / 1000) {
        return null;
      }
    }
    return this.buildPkpass(serial);
  }

  /** A pass "changed" whenever any event touched it (stamp, redeem, ...). */
  private async lastUpdatedAt(passId: string): Promise<Date> {
    const [row] = await this.sql`
      select greatest(p.created_at, max(e.created_at)) as updated_at
      from passes p
      left join events e on e.pass_id = p.id
      where p.id = ${passId}
      group by p.created_at`;
    return (row?.updatedAt as Date | undefined) ?? new Date();
  }

  // The token authenticates web-service calls; created on first .pkpass
  // download, stable afterwards (Apple treats it as part of the pass).
  private async ensureAuthToken(passId: string): Promise<string> {
    const token = randomBytes(16).toString('hex');
    const [row] = await this.sql`
      update passes
      set apple_auth_token = coalesce(apple_auth_token, ${token})
      where id = ${passId}
      returning apple_auth_token`;
    return row!.appleAuthToken as string;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
