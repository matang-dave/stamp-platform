'use client';

// In-memory owner session (token is intentionally NOT persisted to
// localStorage; a page reload requires a new login, same as the stamper).
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { StaffSession } from '@stamp/core';

export type OwnerSession = StaffSession & { token: string; cafeSlug: string };

interface OwnerSessionContextValue {
  session: OwnerSession | null;
  setSession: (session: OwnerSession | null) => void;
}

const OwnerSessionContext = createContext<OwnerSessionContextValue | null>(
  null,
);

export function OwnerSessionProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  /** For tests; production always starts logged out. */
  initialSession?: OwnerSession | null;
}) {
  const [session, setSession] = useState<OwnerSession | null>(initialSession);
  return (
    <OwnerSessionContext.Provider value={{ session, setSession }}>
      {children}
    </OwnerSessionContext.Provider>
  );
}

export function useOwnerSession(): OwnerSessionContextValue {
  const ctx = useContext(OwnerSessionContext);
  if (!ctx) {
    throw new Error('useOwnerSession must be used within OwnerSessionProvider');
  }
  return ctx;
}
