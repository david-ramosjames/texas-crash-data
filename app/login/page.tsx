'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function Login() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <main style={{ maxWidth: 440, margin: '12vh auto', padding: 28 }}>
    <p className="eyebrow">TEXAS CRASH INTELLIGENCE</p><h1>Sign in to your studio</h1>
    <p>This is a private research workspace. Use your invited Supabase account.</p>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      const form = new FormData(e.currentTarget);
      try {
        const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) });
        if (!response.ok) throw new Error((await response.json()).error);
        window.location.assign('/');
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} style={{ display: 'grid', gap: 18, marginTop: 24 }}>
      <label>Email<Input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<Input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p role="alert">{error}</p>}<Button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
    <p style={{ marginTop: 24 }}>Ask your workspace administrator to create or reset your account. Public sign-up is disabled.</p>
  </main>;
}
