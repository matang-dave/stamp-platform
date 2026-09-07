'use client';

import { useEffect, useState } from 'react';
import type { EnrollRequest } from '@stamp/core';
import { enroll } from './enrollment-api';

type Platform = EnrollRequest['platform'];

// Deliberately simple client-side format check; the API validates again.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function detectIos(
  ua: string,
  maxTouchPoints: number = 0,
): boolean {
  // iPadOS 13+ reports a Mac user agent but has a touch screen.
  return /iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
}

interface Props {
  slug: string;
  brandColor: string;
  /** Overridable for tests; defaults to a full-page navigation to the wallet URL. */
  onEnrolled?: (addToWalletUrl: string) => void;
}

export function EnrollForm({ slug, brandColor, onEnrolled }: Props) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false); // unbundled opt-in, default OFF
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Platform | null>(null);
  const [iosFirst, setIosFirst] = useState(false);

  useEffect(() => {
    // Detect after mount to avoid a server/client hydration mismatch.
    setIosFirst(detectIos(navigator.userAgent, navigator.maxTouchPoints));
  }, []);

  async function submit(platform: Platform) {
    setError(null);
    const trimmed = email.trim();
    if (trimmed !== '' && !isValidEmail(trimmed)) {
      setError(
        'Bitte gib eine gültige E-Mail-Adresse ein. / Please enter a valid email address.',
      );
      return;
    }
    setSubmitting(platform);
    try {
      const body: EnrollRequest = { platform };
      if (trimmed !== '') body.email = trimmed;
      if (consent) body.marketingConsent = true;
      const res = await enroll(slug, body);
      const redirect =
        onEnrolled ?? ((url: string) => window.location.assign(url));
      redirect(res.addToWalletUrl);
    } catch {
      setError(
        'Das hat leider nicht geklappt. Bitte versuche es erneut. / Something went wrong. Please try again.',
      );
      setSubmitting(null);
    }
  }

  const appleButton = (
    <button
      key="apple"
      type="button"
      disabled={submitting !== null}
      onClick={() => submit('apple')}
      className="w-full rounded-xl bg-black px-4 py-3 font-medium text-white disabled:opacity-50"
    >
      {submitting === 'apple' ? 'Adding…' : 'Add to Apple Wallet'}
    </button>
  );

  const googleButton = (
    <button
      key="google"
      type="button"
      disabled={submitting !== null}
      onClick={() => submit('google')}
      className="w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
      style={{ backgroundColor: brandColor }}
    >
      {submitting === 'google' ? 'Adding…' : 'Add to Google Wallet'}
    </button>
  );

  return (
    <form className="mt-6" noValidate onSubmit={(e) => e.preventDefault()}>
      <label className="block text-sm font-medium" htmlFor="enroll-email">
        E-Mail (optional)
      </label>
      <input
        id="enroll-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2"
      />

      <label className="mt-3 flex items-start gap-2 text-sm" htmlFor="enroll-consent">
        <input
          id="enroll-consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Ja, ich möchte Neuigkeiten und Angebote dieses Cafés per E-Mail
          erhalten (freiwillig, jederzeit widerrufbar). / Yes, I want to receive
          news and offers from this café by email (optional, revocable at any
          time).
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {iosFirst ? [appleButton, googleButton] : [googleButton, appleButton]}
      </div>
    </form>
  );
}
