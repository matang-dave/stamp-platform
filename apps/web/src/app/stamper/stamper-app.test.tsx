// Component tests for the stamper flow. All API calls are mocked with msw
// against the frozen @stamp/core contract shapes — the real API is never hit.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  PassSummary,
  RedeemResponse,
  ScanResponse,
  StampRequest,
  StampResponse,
} from '@stamp/core';
import type { LoginResponse } from '../../lib/api';
import type { ScannerProps } from './scanner';
import { StamperApp } from './stamper-app';

const API = 'http://api.test';
process.env.NEXT_PUBLIC_API_URL = API;

const QR_PAYLOAD = 'qr-payload-abc';
const TOKEN = 'test-jwt-token';

const staffSession: LoginResponse = {
  token: TOKEN,
  staffId: 'staff-1',
  cafeId: 'cafe-1',
  role: 'barista',
};

function pass(overrides: Partial<PassSummary> = {}): PassSummary {
  return {
    passId: 'pass-1',
    stamps: 3,
    stampsRequired: 5,
    vouchersAvailable: 0,
    lastStampAt: '2026-09-07T09:00:00.000Z',
    ...overrides,
  };
}

const loginHandler = http.post(`${API}/auth/login`, async ({ request }) => {
  const body = (await request.json()) as { cafeSlug: string; staffName: string; pin: string };
  if (body.pin !== '1234') {
    return HttpResponse.json({ message: 'Invalid PIN' }, { status: 401 });
  }
  return HttpResponse.json(staffSession);
});

function scanHandler(response: ScanResponse, seen?: { authorization: string | null }) {
  return http.post(`${API}/stamper/scan`, ({ request }) => {
    if (seen) seen.authorization = request.headers.get('authorization');
    return HttpResponse.json(response);
  });
}

const server = setupServer(loginHandler);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Test seam: the camera can't run in jsdom, so inject a scanner that emits a
// fixed payload on click.
function FakeScanner({ onScan }: ScannerProps) {
  return (
    <button type="button" onClick={() => onScan(QR_PAYLOAD)}>
      simulate scan
    </button>
  );
}

async function loginAs(user: ReturnType<typeof userEvent.setup>, pin = '1234') {
  await user.type(screen.getByLabelText(/café slug/i), 'blue-bottle');
  await user.type(screen.getByLabelText(/your name/i), 'Maya');
  await user.type(screen.getByLabelText(/^pin$/i), pin);
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('StamperApp', () => {
  it('shows an error on a wrong PIN and stays on the login form', async () => {
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user, '9999');

    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong pin/i);
    // Still on the login form, no scan view.
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByText(/simulate scan/i)).not.toBeInTheDocument();
  });

  it('logs in, shows the café name, and shows the pass after a successful scan', async () => {
    const seen = { authorization: null as string | null };
    server.use(
      scanHandler(
        { valid: true, pass: pass({ stamps: 3 }), duplicateScanWarning: false },
        seen,
      ),
    );
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user);
    expect(await screen.findByRole('heading', { name: 'Blue Bottle' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /simulate scan/i }));

    expect(await screen.findByLabelText('3 of 5 stamps')).toHaveTextContent('●●●○○');
    expect(screen.getByRole('button', { name: /\+1 stamp/i })).toBeInTheDocument();
    expect(seen.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('shows an error for an invalid scan', async () => {
    server.use(scanHandler({ valid: false, reason: 'wrong_cafe' }));
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user);
    await user.click(await screen.findByRole('button', { name: /simulate scan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/different café/i);
  });

  it('adds a stamp with +1 stamp and announces an earned voucher', async () => {
    let stampBody: StampRequest | undefined;
    server.use(
      scanHandler({ valid: true, pass: pass({ stamps: 4 }), duplicateScanWarning: false }),
      http.post(`${API}/stamper/stamp`, async ({ request }) => {
        stampBody = (await request.json()) as StampRequest;
        const response: StampResponse = {
          pass: pass({ stamps: 0, vouchersAvailable: 1 }),
          vouchersEarned: 1,
        };
        return HttpResponse.json(response);
      }),
    );
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user);
    await user.click(await screen.findByRole('button', { name: /simulate scan/i }));
    await user.click(await screen.findByRole('button', { name: /\+1 stamp/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/voucher earned/i);
    expect(await screen.findByLabelText('0 of 5 stamps')).toBeInTheDocument();
    expect(stampBody).toEqual({ passId: 'pass-1' }); // no count for a single stamp
  });

  it('hides Redeem when no voucher is available', async () => {
    server.use(
      scanHandler({
        valid: true,
        pass: pass({ vouchersAvailable: 0 }),
        duplicateScanWarning: false,
      }),
    );
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user);
    await user.click(await screen.findByRole('button', { name: /simulate scan/i }));

    await screen.findByRole('button', { name: /\+1 stamp/i });
    expect(screen.queryByRole('button', { name: /redeem/i })).not.toBeInTheDocument();
  });

  it('shows Redeem when a voucher is available and redeems it', async () => {
    server.use(
      scanHandler({
        valid: true,
        pass: pass({ vouchersAvailable: 2 }),
        duplicateScanWarning: false,
      }),
      http.post(`${API}/stamper/redeem`, () => {
        const response: RedeemResponse = {
          redeemed: true,
          pass: pass({ vouchersAvailable: 1 }),
        };
        return HttpResponse.json(response);
      }),
    );
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user);
    await user.click(await screen.findByRole('button', { name: /simulate scan/i }));

    const redeemButton = await screen.findByRole('button', { name: /redeem/i });
    await user.click(redeemButton);

    expect(await screen.findByRole('status')).toHaveTextContent(/voucher redeemed/i);
    expect(screen.getByText(/vouchers available: 1/i)).toBeInTheDocument();
  });

  it('blocks actions behind a duplicate-scan warning until overridden', async () => {
    server.use(
      scanHandler({
        valid: true,
        pass: pass({ vouchersAvailable: 1 }),
        duplicateScanWarning: true,
      }),
    );
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} />);

    await loginAs(user);
    await user.click(await screen.findByRole('button', { name: /simulate scan/i }));

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/duplicate scan/i);
    expect(screen.queryByRole('button', { name: /\+1 stamp/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^redeem$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /override/i }));

    expect(screen.getByRole('button', { name: /\+1 stamp/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /redeem/i })).toBeInTheDocument();
    expect(screen.queryByText(/duplicate scan/i)).not.toBeInTheDocument();
  });

  it('long-press on +1 stamp reveals paper-card migration and sends count', async () => {
    let stampBody: StampRequest | undefined;
    server.use(
      scanHandler({ valid: true, pass: pass({ stamps: 0 }), duplicateScanWarning: false }),
      http.post(`${API}/stamper/stamp`, async ({ request }) => {
        stampBody = (await request.json()) as StampRequest;
        const response: StampResponse = { pass: pass({ stamps: 4 }), vouchersEarned: 0 };
        return HttpResponse.json(response);
      }),
    );
    const user = userEvent.setup();
    render(<StamperApp ScannerComponent={FakeScanner} longPressMs={30} />);

    await loginAs(user);
    await user.click(await screen.findByRole('button', { name: /simulate scan/i }));

    const stampButton = await screen.findByRole('button', { name: /\+1 stamp/i });
    fireEvent.pointerDown(stampButton);
    await new Promise((resolve) => setTimeout(resolve, 80));
    fireEvent.pointerUp(stampButton);

    const panel = await screen.findByRole('form', { name: /paper card migration/i });
    const countInput = screen.getByLabelText(/stamps to add/i);
    await user.clear(countInput);
    await user.type(countInput, '4');
    await user.click(
      screen.getByRole('button', { name: /add 4 stamps \(paper card migration\)/i }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(/added 4 stamps/i);
    expect(stampBody).toEqual({ passId: 'pass-1', count: 4 });
    expect(panel).not.toBeInTheDocument(); // panel closes after a successful migration
  });
});
