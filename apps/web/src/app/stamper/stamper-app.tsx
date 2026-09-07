'use client';

// Staff-facing stamper flow: PIN login -> scan a customer QR -> stamp/redeem.
// The JWT lives in component state only (never localStorage). The camera is
// isolated in Scanner; tests inject a fake via the ScannerComponent prop.
import { useCallback, useRef, useState, type ComponentType } from 'react';
import type { PassSummary } from '@stamp/core';
import {
  ApiError,
  login,
  redeemVoucher,
  scanPass,
  stampPass,
  type LoginResponse,
} from '../../lib/api';
import { Scanner, type ScannerProps } from './scanner';

const DEFAULT_LONG_PRESS_MS = 600;

const SCAN_FAIL_REASONS: Record<string, string> = {
  bad_signature: 'Invalid QR code — not one of ours.',
  unknown_pass: 'Unknown pass. Ask the customer to re-add the card.',
  wrong_cafe: 'This card belongs to a different café.',
};

interface CurrentPass {
  pass: PassSummary;
  duplicateWarning: boolean;
  overridden: boolean;
  notice: string | null;
  error: string | null;
}

function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function StampDots({ pass }: { pass: PassSummary }) {
  const filled = Math.min(pass.stamps, pass.stampsRequired);
  const dots = '●'.repeat(filled) + '○'.repeat(Math.max(pass.stampsRequired - filled, 0));
  return (
    <p
      aria-label={`${pass.stamps} of ${pass.stampsRequired} stamps`}
      className="text-3xl tracking-widest"
    >
      {dots}
    </p>
  );
}

export interface StamperAppProps {
  /** Test seam: replaces the camera scanner with any ScannerProps component. */
  ScannerComponent?: ComponentType<ScannerProps>;
  /** Test seam: how long a press on “+1 stamp” counts as a long-press. */
  longPressMs?: number;
}

export function StamperApp({
  ScannerComponent = Scanner,
  longPressMs = DEFAULT_LONG_PRESS_MS,
}: StamperAppProps) {
  // --- auth (token kept in memory only) ---
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [cafeName, setCafeName] = useState('');
  const [cafeSlug, setCafeSlug] = useState('');
  const [staffName, setStaffName] = useState('');
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // --- scan / pass state ---
  const [current, setCurrent] = useState<CurrentPass | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationCount, setMigrationCount] = useState('5');

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const beginBusy = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const endBusy = () => {
    busyRef.current = false;
    setBusy(false);
  };

  // --- long-press plumbing for the +1 stamp button ---
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setMigrationOpen(true);
    }, longPressMs);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!beginBusy()) return;
    setLoginError(null);
    try {
      const res = await login({ cafeSlug: cafeSlug.trim(), staffName: staffName.trim(), pin });
      setSession(res);
      setCafeName(prettifySlug(cafeSlug.trim()));
      setPin('');
    } catch (err) {
      setLoginError(
        err instanceof ApiError && err.status === 401
          ? 'Wrong PIN — try again.'
          : 'Login failed. Check your connection and try again.',
      );
    } finally {
      endBusy();
    }
  };

  const handleScan = useCallback(
    async (qrPayload: string) => {
      if (!session || !beginBusy()) return;
      setScanError(null);
      try {
        const res = await scanPass({ qrPayload }, session.token);
        if (!res.valid) {
          setScanError(SCAN_FAIL_REASONS[res.reason] ?? 'Scan failed.');
        } else {
          setMigrationOpen(false);
          setCurrent({
            pass: res.pass,
            duplicateWarning: res.duplicateScanWarning,
            overridden: false,
            notice: null,
            error: null,
          });
        }
      } catch {
        setScanError('Scan failed. Check your connection and try again.');
      } finally {
        endBusy();
      }
    },
    [session],
  );

  const addStamps = async (count: number) => {
    if (!session || !current || !beginBusy()) return;
    try {
      const res = await stampPass(
        { passId: current.pass.passId, ...(count > 1 ? { count } : {}) },
        session.token,
      );
      setMigrationOpen(false);
      setCurrent({
        pass: res.pass,
        duplicateWarning: false,
        overridden: true,
        notice:
          res.vouchersEarned > 0
            ? `Voucher earned! ${count > 1 ? `Added ${count} stamps.` : ''}`.trim()
            : count > 1
              ? `Added ${count} stamps.`
              : 'Stamp added.',
        error: null,
      });
    } catch (err) {
      setCurrent((c) =>
        c ? { ...c, error: err instanceof ApiError ? err.message : 'Stamping failed.' } : c,
      );
    } finally {
      endBusy();
    }
  };

  const handleRedeem = async () => {
    if (!session || !current || !beginBusy()) return;
    try {
      const res = await redeemVoucher({ passId: current.pass.passId }, session.token);
      if (res.redeemed) {
        setCurrent({
          pass: res.pass,
          duplicateWarning: false,
          overridden: true,
          notice: 'Voucher redeemed.',
          error: null,
        });
      } else {
        setCurrent((c) => (c ? { ...c, error: 'No voucher available to redeem.' } : c));
      }
    } catch (err) {
      setCurrent((c) =>
        c ? { ...c, error: err instanceof ApiError ? err.message : 'Redeem failed.' } : c,
      );
    } finally {
      endBusy();
    }
  };

  const resetToScan = () => {
    setCurrent(null);
    setMigrationOpen(false);
    setScanError(null);
  };

  // ---------- render ----------

  if (!session) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-2xl font-semibold">Stamper</h1>
        <p className="mt-1 text-neutral-500">Staff login</p>
        <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Café slug
            <input
              value={cafeSlug}
              onChange={(e) => setCafeSlug(e.target.value)}
              autoComplete="organization"
              required
              className="rounded-lg border border-neutral-300 px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Your name
            <input
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              autoComplete="name"
              required
              className="rounded-lg border border-neutral-300 px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            PIN
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              className="rounded-lg border border-neutral-300 px-3 py-2 text-base"
            />
          </label>
          {loginError && (
            <p role="alert" className="text-sm text-red-600">
              {loginError}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Log in
          </button>
        </form>
      </main>
    );
  }

  const actionsUnlocked = current !== null && (!current.duplicateWarning || current.overridden);

  return (
    <main className="mx-auto max-w-md p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{cafeName}</h1>
          <p className="text-sm text-neutral-500">
            {session.role === 'owner' ? 'Owner' : 'Barista'} · stamper
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSession(null);
            setCurrent(null);
          }}
          className="text-sm text-neutral-500 underline"
        >
          Log out
        </button>
      </header>

      {current === null ? (
        <section aria-label="Scan a customer card" className="flex flex-col gap-3">
          <ScannerComponent onScan={handleScan} />
          {scanError && (
            <p role="alert" className="text-sm text-red-600">
              {scanError}
            </p>
          )}
          <p className="text-sm text-neutral-500">Point the camera at the customer’s QR code.</p>
        </section>
      ) : (
        <section aria-label="Customer pass" className="flex flex-col gap-4">
          <StampDots pass={current.pass} />
          <p className="text-sm text-neutral-600">
            Vouchers available: {current.pass.vouchersAvailable}
          </p>

          {current.duplicateWarning && !current.overridden && (
            <div
              role="alert"
              className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p className="font-medium">Duplicate scan warning</p>
              <p>This pass was already scanned moments ago.</p>
              <button
                type="button"
                onClick={() =>
                  setCurrent((c) => (c ? { ...c, overridden: true } : c))
                }
                className="mt-2 rounded-md border border-amber-500 px-3 py-1 font-medium"
              >
                Override — stamp anyway
              </button>
            </div>
          )}

          {current.notice && (
            <p role="status" className="text-sm font-medium text-green-700">
              {current.notice}
            </p>
          )}
          {current.error && (
            <p role="alert" className="text-sm text-red-600">
              {current.error}
            </p>
          )}

          {actionsUnlocked && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onPointerDown={startPress}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onClick={() => {
                    if (longPressed.current) {
                      // The long-press already opened the migration panel.
                      longPressed.current = false;
                      return;
                    }
                    void addStamps(1);
                  }}
                  className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 font-medium text-white disabled:opacity-50"
                >
                  +1 stamp
                </button>
                {current.pass.vouchersAvailable > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRedeem()}
                    className="flex-1 rounded-lg border border-neutral-900 px-4 py-3 font-medium disabled:opacity-50"
                  >
                    Redeem
                  </button>
                )}
              </div>
              <p className="text-xs text-neutral-400">
                Tip: long-press “+1 stamp” to migrate a paper card.
              </p>

              {migrationOpen && (
                <form
                  aria-label="Paper card migration"
                  className="flex flex-col gap-2 rounded-lg border border-neutral-300 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const count = Number.parseInt(migrationCount, 10);
                    if (Number.isFinite(count) && count > 0) void addStamps(count);
                  }}
                >
                  <label className="flex flex-col gap-1 text-sm">
                    Stamps to add
                    <input
                      type="number"
                      min={1}
                      value={migrationCount}
                      onChange={(e) => setMigrationCount(e.target.value)}
                      className="rounded-lg border border-neutral-300 px-3 py-2 text-base"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
                  >
                    Add {migrationCount || '…'} stamps (paper card migration)
                  </button>
                </form>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={resetToScan}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm"
          >
            Scan next customer
          </button>
        </section>
      )}
    </main>
  );
}
