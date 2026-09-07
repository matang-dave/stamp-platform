import { randomInt } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OwnerStats } from '@stamp/core';
import type { StaffSession } from '../auth/auth.service.js';
import { hashPin } from '../auth/pin.js';
import { SQL } from '../db/db.provider.js';
import type { Sql } from '../db/db.provider.js';
import { ApplePassPush } from '../wallet/apple/apple-pass-push.js';
import { GoogleWalletService } from '../wallet/google/google-wallet.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StaffMember {
  staffId: string;
  name: string;
  role: 'owner' | 'barista';
  status: 'active' | 'disabled';
  createdAt: string; // ISO
}

export interface CreatedStaff {
  staffId: string;
  name: string;
  role: 'barista';
  /** Shown exactly once (only hash is stored) — the owner hands it to the barista. */
  pin: string;
}

export interface BroadcastResult {
  sent: true;
  /** Number of café passes the broadcast was fanned out to. */
  recipients: number;
}

// Owner mini-admin (milestone 6). Every query is scoped to the session's
// cafe_id — an owner can only ever see and manage their own café.
@Injectable()
export class OwnerService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly googleWallet: GoogleWalletService,
    private readonly applePush: ApplePassPush,
  ) {}

  /** The three OwnerStats aggregates, all scoped to the session café. */
  async stats(staff: StaffSession): Promise<OwnerStats> {
    const [row] = await this.sql`
      select
        (select count(*)::int from passes
          where cafe_id = ${staff.cafeId}) as passes_issued,
        (select coalesce(sum((e.detail->>'count')::int), 0)::int from events e
          where e.cafe_id = ${staff.cafeId}
            and e.action in ('stamp', 'stamp_bulk')
            and e.created_at > now() - interval '7 days') as stamps_this_week,
        (select count(*)::int from vouchers v
          join passes p on p.id = v.pass_id
          where p.cafe_id = ${staff.cafeId}
            and v.redeemed_at is not null) as vouchers_redeemed`;
    return {
      passesIssued: row!.passesIssued as number,
      stampsThisWeek: row!.stampsThisWeek as number,
      vouchersRedeemed: row!.vouchersRedeemed as number,
    };
  }

  /**
   * Lock-screen broadcast to all of the café's passes. Google passes get the
   * message patched onto their loyalty object; Apple passes get an APNs push
   * (the device then refetches the pass, whose back field carries the
   * message). Both sides no-op gracefully without wallet credentials, and a
   * single undeliverable pass never fails the broadcast.
   */
  async broadcast(staff: StaffSession, message: string): Promise<BroadcastResult> {
    // Audit first: the broadcast event is also what marks the café's Apple
    // passes as "changed" for the PassKit web service.
    await this.sql`
      insert into events (cafe_id, staff_id, action, detail)
      values (${staff.cafeId}, ${staff.staffId}, 'broadcast', ${this.sql.json({ message })})`;

    const passes = await this.sql`
      select id, platform from passes where cafe_id = ${staff.cafeId}`;
    for (const pass of passes) {
      if (pass.platform === 'google') {
        await this.googleWallet.pushMessage(pass.id as string, message);
      } else {
        await this.applePush.passChanged(pass.id as string);
      }
    }
    return { sent: true, recipients: passes.length };
  }

  async listStaff(staff: StaffSession): Promise<StaffMember[]> {
    const rows = await this.sql`
      select id, name, role, status, created_at
      from staff where cafe_id = ${staff.cafeId}
      order by created_at, id`;
    return rows.map((r) => ({
      staffId: r.id as string,
      name: r.name as string,
      role: r.role as StaffMember['role'],
      status: r.status as StaffMember['status'],
      createdAt: (r.createdAt as Date).toISOString(),
    }));
  }

  /** Creates a barista in the session café with a generated 4-digit PIN. */
  async createStaff(staff: StaffSession, name: string): Promise<CreatedStaff> {
    const pin = String(randomInt(0, 10_000)).padStart(4, '0');
    const pinHash = await hashPin(pin);
    const [row] = await this.sql`
      insert into staff (cafe_id, name, role, pin_hash)
      values (${staff.cafeId}, ${name}, 'barista', ${pinHash})
      returning id`;
    await this.sql`
      insert into events (cafe_id, staff_id, action, detail)
      values (${staff.cafeId}, ${staff.staffId}, 'staff_created',
              ${this.sql.json({ staffId: row!.id as string, name })})`;
    return { staffId: row!.id as string, name, role: 'barista', pin };
  }

  /**
   * Soft-disables a staff member (login stops working, audit history stays).
   * Scoped by cafe_id, so staff of other cafés are indistinguishable from
   * unknown ids (404) — tenancy-safe by construction.
   */
  async disableStaff(staff: StaffSession, staffId: string): Promise<{ disabled: true }> {
    if (!UUID_RE.test(staffId ?? '')) {
      throw new NotFoundException('unknown_staff');
    }
    if (staffId === staff.staffId) {
      throw new BadRequestException('cannot_disable_self');
    }
    const [row] = await this.sql`
      update staff set status = 'disabled'
      where id = ${staffId} and cafe_id = ${staff.cafeId}
      returning id`;
    if (!row) {
      throw new NotFoundException('unknown_staff');
    }
    await this.sql`
      insert into events (cafe_id, staff_id, action, detail)
      values (${staff.cafeId}, ${staff.staffId}, 'staff_disabled',
              ${this.sql.json({ staffId })})`;
    return { disabled: true };
  }
}
