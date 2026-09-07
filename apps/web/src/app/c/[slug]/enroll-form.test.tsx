import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EnrollRequest, EnrollResponse } from '@stamp/core';
import { detectIos, EnrollForm, isValidEmail } from './enroll-form';

const API = 'http://localhost:3000';

let lastEnrollBody: EnrollRequest | null = null;

const server = setupServer(
  http.post(`${API}/c/:slug/enroll`, async ({ request }) => {
    lastEnrollBody = (await request.json()) as EnrollRequest;
    const res: EnrollResponse = {
      passId: 'pass-123',
      addToWalletUrl: `/wallet/${lastEnrollBody.platform}/pass-123`,
    };
    return HttpResponse.json(res);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  lastEnrollBody = null;
});
afterAll(() => server.close());

describe('EnrollForm', () => {
  it('renders consent checkbox unchecked by default', () => {
    render(<EnrollForm slug="demo" brandColor="#336699" />);
    const consent = screen.getByRole('checkbox') as HTMLInputElement;
    expect(consent.checked).toBe(false);
  });

  it('rejects an invalid email client-side without calling the API', async () => {
    const user = userEvent.setup();
    const onEnrolled = vi.fn();
    render(
      <EnrollForm slug="demo" brandColor="#336699" onEnrolled={onEnrolled} />,
    );

    await user.type(screen.getByRole('textbox'), 'not-an-email');
    await user.click(
      screen.getByRole('button', { name: /add to google wallet/i }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/valid email address/i);
    expect(onEnrolled).not.toHaveBeenCalled();
    expect(lastEnrollBody).toBeNull();
  });

  it('enrolls without email and redirects to addToWalletUrl', async () => {
    const user = userEvent.setup();
    const onEnrolled = vi.fn();
    render(
      <EnrollForm slug="demo" brandColor="#336699" onEnrolled={onEnrolled} />,
    );

    await user.click(
      screen.getByRole('button', { name: /add to google wallet/i }),
    );

    await waitFor(() =>
      expect(onEnrolled).toHaveBeenCalledWith('/wallet/google/pass-123'),
    );
    expect(lastEnrollBody).toEqual({ platform: 'google' });
  });

  it('sends email and marketingConsent only when explicitly given', async () => {
    const user = userEvent.setup();
    const onEnrolled = vi.fn();
    render(
      <EnrollForm slug="demo" brandColor="#336699" onEnrolled={onEnrolled} />,
    );

    await user.type(screen.getByRole('textbox'), 'jane@example.com');
    await user.click(screen.getByRole('checkbox'));
    await user.click(
      screen.getByRole('button', { name: /add to apple wallet/i }),
    );

    await waitFor(() =>
      expect(onEnrolled).toHaveBeenCalledWith('/wallet/apple/pass-123'),
    );
    expect(lastEnrollBody).toEqual({
      platform: 'apple',
      email: 'jane@example.com',
      marketingConsent: true,
    });
  });

  it('shows an error when the API rejects the enrollment', async () => {
    server.use(
      http.post(`${API}/c/:slug/enroll`, () =>
        HttpResponse.json({ message: 'nope' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    const onEnrolled = vi.fn();
    render(
      <EnrollForm slug="demo" brandColor="#336699" onEnrolled={onEnrolled} />,
    );

    await user.click(
      screen.getByRole('button', { name: /add to google wallet/i }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/something went wrong/i);
    expect(onEnrolled).not.toHaveBeenCalled();
  });
});

describe('isValidEmail', () => {
  it.each(['jane@example.com', 'a.b+c@sub.domain.co'])('accepts %s', (v) => {
    expect(isValidEmail(v)).toBe(true);
  });
  it.each(['plain', 'a@b', 'a b@c.de', '@x.com', 'a@.com '])(
    'rejects %s',
    (v) => {
      expect(isValidEmail(v)).toBe(false);
    },
  );
});

describe('detectIos (platform auto-detect)', () => {
  it('detects iPhone user agents', () => {
    expect(
      detectIos(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      ),
    ).toBe(true);
  });
  it('detects iPadOS masquerading as Mac via touch points', () => {
    expect(detectIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(
      true,
    );
  });
  it('treats Android as non-iOS', () => {
    expect(detectIos('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(false);
  });

  it('puts the Apple button first on iOS', async () => {
    const originalUa = navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      configurable: true,
    });
    try {
      render(<EnrollForm slug="demo" brandColor="#336699" />);
      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        expect(buttons[0].textContent).toMatch(/apple wallet/i);
        expect(buttons[1].textContent).toMatch(/google wallet/i);
      });
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: originalUa,
        configurable: true,
      });
    }
  });
});
