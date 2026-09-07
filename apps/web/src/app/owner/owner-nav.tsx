'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOwnerSession } from './session-provider';

const TABS = [
  { href: '/owner/stats', label: 'Stats' },
  { href: '/owner/broadcast', label: 'Broadcast' },
  { href: '/owner/staff', label: 'Staff' },
] as const;

export function OwnerNav() {
  const pathname = usePathname();
  const { session, setSession } = useOwnerSession();

  return (
    <header className="mb-6 border-b pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          <Link href="/owner">Owner admin</Link>
        </h1>
        {session && (
          <button
            type="button"
            onClick={() => setSession(null)}
            className="text-sm text-neutral-500 underline"
          >
            Log out ({session.cafeSlug})
          </button>
        )}
      </div>
      {session && (
        <nav aria-label="Owner sections" className="mt-3 flex gap-4 text-sm">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={pathname === tab.href ? 'page' : undefined}
              className={
                pathname === tab.href
                  ? 'font-semibold underline'
                  : 'text-neutral-500 hover:underline'
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
