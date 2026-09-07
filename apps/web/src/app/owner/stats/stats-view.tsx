'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { OwnerStats } from '@stamp/core';
import { fetchOwnerStats } from '../owner-api';
import { useOwnerSession } from '../session-provider';

export function StatsView() {
  const { session } = useOwnerSession();
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchOwnerStats(session.token)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load stats. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) {
    return (
      <p className="text-neutral-600">
        Please{' '}
        <Link className="underline" href="/owner">
          log in
        </Link>{' '}
        as owner to see stats.
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-red-600">
        {error}
      </p>
    );
  }

  if (!stats) return <p className="text-neutral-500">Loading stats…</p>;

  const items: { label: string; value: number }[] = [
    { label: 'Passes issued', value: stats.passesIssued },
    { label: 'Stamps this week', value: stats.stampsThisWeek },
    { label: 'Vouchers redeemed', value: stats.vouchersRedeemed },
  ];

  return (
    <div>
      <h2 className="text-lg font-medium">Stats</h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border p-4">
            <dt className="text-sm text-neutral-500">{item.label}</dt>
            <dd className="mt-1 text-3xl font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
