import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { BroadcastRequest, OwnerStats } from '@stamp/core';
import { BroadcastForm } from './broadcast/broadcast-form';
import { LoginForm } from './login-form';
import type { LoginResponse } from './owner-api';
import { OwnerSessionProvider, type OwnerSession } from './session-provider';
import { StaffList } from './staff/staff-list';
import { StatsView } from './stats/stats-view';

const API = 'http://localhost:3000';

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/owner',
}));

const ownerLogin: LoginResponse = {
  token: 'jwt-owner',
  staffId: 'staff-1',
  cafeId: 'cafe-1',
  role: 'owner',
};

const stats: OwnerStats = {
  passesIssued: 42,
  stampsThisWeek: 7,
  vouchersRedeemed: 3,
};

let lastBroadcastBody: BroadcastRequest | null = null;
let lastStatsAuth: string | null = null;

const server = setupServer(
  http.post(`${API}/auth/login`, () => HttpResponse.json(ownerLogin)),
  http.get(`${API}/owner/stats`, ({ request }) => {
    lastStatsAuth = request.headers.get('authorization');
    return HttpResponse.json(stats);
  }),
  http.post(`${API}/owner/broadcast`, async ({ request }) => {
    lastBroadcastBody = (await request.json()) as BroadcastRequest;
    return HttpResponse.json({ ok: true }, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  routerPush.mockReset();
  lastBroadcastBody = null;
  lastStatsAuth = null;
});
afterAll(() => server.close());

const session: OwnerSession = { ...ownerLogin, cafeSlug: 'demo' };

function withSession(children: ReactNode, initial: OwnerSession | null = null) {
  return (
    <OwnerSessionProvider initialSession={initial}>
      {children}
    </OwnerSessionProvider>
  );
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/café slug/i), 'demo');
  await user.type(screen.getByLabelText(/your name/i), 'Maria');
  await user.type(screen.getByLabelText(/pin/i), '1234');
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginForm', () => {
  it('logs an owner in and navigates to stats', async () => {
    const user = userEvent.setup();
    render(withSession(<LoginForm />));

    await fillLogin(user);

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/owner/stats'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects a barista login (role must be owner)', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ ...ownerLogin, role: 'barista' }),
      ),
    );
    const user = userEvent.setup();
    render(withSession(<LoginForm />));

    await fillLogin(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/owners only/i);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('shows an error on wrong credentials', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    render(withSession(<LoginForm />));

    await fillLogin(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/login failed/i);
    expect(routerPush).not.toHaveBeenCalled();
  });
});

describe('StatsView', () => {
  it('asks for login when there is no session', () => {
    render(withSession(<StatsView />));
    expect(screen.getByText(/log in/i)).toBeDefined();
  });

  it('renders OwnerStats from the API with the bearer token', async () => {
    render(withSession(<StatsView />, session));

    expect((await screen.findByText('42')).textContent).toBe('42');
    expect(screen.getByText(/passes issued/i)).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
    expect(screen.getByText(/stamps this week/i)).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText(/vouchers redeemed/i)).toBeDefined();
    expect(lastStatsAuth).toBe('Bearer jwt-owner');
  });
});

describe('BroadcastForm', () => {
  it('shows a live character counter capped at 140', async () => {
    const user = userEvent.setup();
    render(withSession(<BroadcastForm />, session));

    expect(screen.getByTestId('broadcast-counter').textContent).toBe('0/140');
    await user.type(screen.getByLabelText(/broadcast message/i), 'Hello!');
    expect(screen.getByTestId('broadcast-counter').textContent).toBe('6/140');
  });

  it('disables send when the message exceeds 140 characters', async () => {
    const user = userEvent.setup();
    render(withSession(<BroadcastForm />, session));

    const textarea = screen.getByLabelText(/broadcast message/i);
    await user.click(textarea);
    await user.paste('x'.repeat(141));

    expect(screen.getByTestId('broadcast-counter').textContent).toBe('141/140');
    const button = screen.getByRole('button', {
      name: /send broadcast/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(lastBroadcastBody).toBeNull();
  });

  it('sends the broadcast and confirms', async () => {
    const user = userEvent.setup();
    render(withSession(<BroadcastForm />, session));

    await user.type(
      screen.getByLabelText(/broadcast message/i),
      'Fresh buns today!',
    );
    await user.click(screen.getByRole('button', { name: /send broadcast/i }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/broadcast sent/i);
    expect(lastBroadcastBody).toEqual({ message: 'Fresh buns today!' });
  });
});

describe('StaffList', () => {
  it('renders the read-only shell when logged in', () => {
    render(withSession(<StaffList />, session));
    expect(screen.getByText(/read-only in this version/i)).toBeDefined();
    expect(screen.getByText(/you \(owner\)/i)).toBeDefined();
  });
});
