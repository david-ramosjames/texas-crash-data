import { authClient, allowedUser, sameOrigin } from '@/lib/auth';
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return Response.json({ error: 'Cross-origin request denied.' }, { status: 403 });
    if (Number(req.headers.get('content-length')) > 8192) return new Response(null, { status: 413 });
    const reader=req.body?.getReader(); if(!reader)return new Response(null,{status:400});
    let text='',size=0;const decoder=new TextDecoder();
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return new Response(null,{status:413});}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();
    const { email, password } = JSON.parse(text);
    if (typeof email !== 'string' || typeof password !== 'string' || !allowedUser(email))
      return Response.json({ error: 'Unable to sign in with these credentials.' }, { status: 401 });
    const { error, data } = await (await authClient()).auth.signInWithPassword({ email, password });
    if (error || !allowedUser(data.user?.email)) return Response.json({ error: 'Unable to sign in with these credentials.' }, { status: 401 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Login is unavailable. Check the deployment configuration.' }, { status: 503 }); }
}
