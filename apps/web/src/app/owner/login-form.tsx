'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { login } from './owner-api';
import { useOwnerSession } from './session-provider';

export function LoginForm() {
  const router = useRouter();
  const { session, setSession } = useOwnerSession();
  const [cafeSlug, setCafeSlug] = useState('');
  const [staffName, setStaffName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) {
    return (
      <p className="text-neutral-600">
        Logged in as {session.role} of “{session.cafeSlug}”.{' '}
        <Link className="underline" href="/owner/stats">
          Go to stats
        </Link>
      </p>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(cafeSlug.trim(), staffName.trim(), pin);
      if (res.role !== 'owner') {
        setError(
          'This area is for café owners only — please use the stamper app instead.',
        );
        return;
      }
      setSession({ ...res, cafeSlug: cafeSlug.trim() });
      router.push('/owner/stats');
    } catch {
      setError('Login failed — check café, name and PIN.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm">
      <h2 className="text-lg font-medium">Owner login</h2>

      <label className="mt-4 block text-sm font-medium" htmlFor="owner-cafe">
        Café slug
      </label>
      <input
        id="owner-cafe"
        value={cafeSlug}
        onChange={(e) => setCafeSlug(e.target.value)}
        required
        autoComplete="organization"
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2"
      />

      <label className="mt-3 block text-sm font-medium" htmlFor="owner-name">
        Your name
      </label>
      <input
        id="owner-name"
        value={staffName}
        onChange={(e) => setStaffName(e.target.value)}
        required
        autoComplete="username"
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2"
      />

      <label className="mt-3 block text-sm font-medium" htmlFor="owner-pin">
        PIN
      </label>
      <input
        id="owner-pin"
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        required
        autoComplete="current-password"
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-5 w-full rounded-xl bg-black px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
