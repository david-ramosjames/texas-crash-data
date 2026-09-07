import { authClient, sameOrigin } from '@/lib/auth';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  await (await authClient()).auth.signOut();
  return Response.json({ ok: true });
}
