// Staff-facing stamper: barista PIN login, camera QR scan, stamp/redeem.
import type { Metadata } from 'next';
import { StamperApp } from './stamper-app';

export const metadata: Metadata = { title: 'Stamper' };

export default function StamperPage() {
  return <StamperApp />;
}
