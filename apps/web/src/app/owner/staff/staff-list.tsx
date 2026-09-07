'use client';

// Read-only staff list shell for the MVP.
// TODO(T10): wire GET /owner/staff (+ add/deactivate actions) once the staff
// management API lands; this shell intentionally renders no fake data.
import Link from 'next/link';
import { useOwnerSession } from '../session-provider';

export function StaffList() {
  const { session } = useOwnerSession();

  if (!session) {
    return (
      <p className="text-neutral-600">
        Please{' '}
        <Link className="underline" href="/owner">
          log in
        </Link>{' '}
        as owner to see your staff.
      </p>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-medium">Staff</h2>
      <p className="mt-2 text-sm text-neutral-500">
        Read-only in this version — staff management (add baristas, reset PINs)
        is coming soon.
      </p>
      <ul className="mt-4 divide-y rounded-2xl border">
        <li className="flex items-center justify-between p-4">
          <span>You (owner)</span>
          <span className="text-sm text-neutral-500">owner</span>
        </li>
        <li className="p-4 text-sm text-neutral-400">
          Baristas will appear here once staff management ships.
        </li>
      </ul>
    </div>
  );
}
