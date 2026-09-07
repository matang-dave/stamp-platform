import type { ReactNode } from 'react';
import { OwnerNav } from './owner-nav';
import { OwnerSessionProvider } from './session-provider';

// The provider lives in the layout so the in-memory token survives
// client-side navigation between /owner/* pages.
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <OwnerSessionProvider>
      <div className="mx-auto max-w-2xl p-6">
        <OwnerNav />
        {children}
      </div>
    </OwnerSessionProvider>
  );
}
