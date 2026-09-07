// Café owner mini-admin: login shell. Stats, broadcast and staff live in
// nested routes; the session provider in layout.tsx keeps the token in memory.
import { LoginForm } from './login-form';

export default function OwnerPage() {
  return (
    <main>
      <LoginForm />
    </main>
  );
}
