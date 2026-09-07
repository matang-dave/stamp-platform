'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { sendBroadcast } from '../owner-api';
import { useOwnerSession } from '../session-provider';

export const BROADCAST_MAX_LENGTH = 140;

export function BroadcastForm() {
  const { session } = useOwnerSession();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!session) {
    return (
      <p className="text-neutral-600">
        Please{' '}
        <Link className="underline" href="/owner">
          log in
        </Link>{' '}
        as owner to send a broadcast.
      </p>
    );
  }

  const overLimit = message.length > BROADCAST_MAX_LENGTH;
  const disabled = submitting || overLimit || message.trim().length === 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    setSubmitting(true);
    try {
      await sendBroadcast(session!.token, { message: message.trim() });
      setSent(true);
      setMessage('');
    } catch {
      setError('Broadcast failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-lg">
      <h2 className="text-lg font-medium">Broadcast to all passes</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Shows up on your customers’ wallet passes. Keep it short.
      </p>

      <label className="sr-only" htmlFor="broadcast-message">
        Broadcast message
      </label>
      <textarea
        id="broadcast-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="Fresh cinnamon buns today until 4pm!"
        className="mt-3 w-full rounded-xl border border-neutral-300 px-3 py-2"
      />
      <p
        data-testid="broadcast-counter"
        className={`mt-1 text-right text-sm ${
          overLimit ? 'font-semibold text-red-600' : 'text-neutral-500'
        }`}
      >
        {message.length}/{BROADCAST_MAX_LENGTH}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {sent && (
        <p role="status" className="mt-2 text-sm text-green-700">
          Broadcast sent.
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="mt-4 rounded-xl bg-black px-4 py-3 font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send broadcast'}
      </button>
    </form>
  );
}
