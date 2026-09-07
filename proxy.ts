import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
export async function proxy(req: NextRequest) {
  let response = NextResponse.next({ request:req });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return response;
  const client = createServerClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll:()=>req.cookies.getAll(),setAll:values=>{
      values.forEach(({name,value})=>req.cookies.set(name,value));
      response = NextResponse.next({request:req});
      values.forEach(({name,value,options})=>response.cookies.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'}));
    }},
  });
  await client.auth.getUser();
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config = { matcher:['/', '/api/((?!health).*)'] };
