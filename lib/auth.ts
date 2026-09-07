import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
export function allowedUser(email?: string) {
  return !!email && (process.env.STUDIO_ALLOWED_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
export async function authClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)
    throw new Error('Supabase login is not configured. See the deployment guide.');
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: values => { try { values.forEach(({ name, value, options }) => jar.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })); } catch { /* Read-only server component; refresh occurs in API handlers. */ } },
    },
  });
}
export async function getUser() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return null;
  const { data: { user }, error } = await (await authClient()).auth.getUser();
  if (error || !user || !allowedUser(user.email)) return null;
  return { id: user.id, displayName: user.email! };
}
export async function requireUser() { const user = await getUser(); if (!user) redirect('/login'); return user; }
export function sameOrigin(req: Request) {
  const expected = process.env.APP_URL;
  if (!expected) throw new Error('APP_URL is not configured.');
  return req.headers.get('origin') === new URL(expected).origin;
}
