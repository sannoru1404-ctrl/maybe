import { NextResponse } from 'next/server';
import { z } from 'zod';
async function supabaseQuery<T>(table:string, params:Record<string,string>):Promise<T[]> { const base=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY; if(!base||!key) throw new Error('Supabase is not configured'); const u=new URL(`/rest/v1/${table}`,base); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v)); const r=await fetch(u,{headers:{apikey:key,Authorization:`Bearer ${key}`,'Accept-Profile':'subshare','Content-Profile':'subshare'},cache:'no-store'}); if(!r.ok) throw new Error(`Database request failed: ${r.status}`); return r.json() as Promise<T[]>; }
export async function GET(request: Request){
 try { const u=new URL(request.url); const q=z.object({category:z.enum(['design','education','media','vpn']).optional(),q:z.string().trim().max(100).optional()}).parse({category:u.searchParams.get('category')||undefined,q:u.searchParams.get('q')||undefined}); const filters:Record<string,string>={select:'id,service,slug,category,available_slots,price',status:'eq.active',available_slots:'gt.0',order:'created_at.desc'};
  if(q.category) filters.category=`eq.${q.category}`; if(q.q) filters.service=`ilike.*${q.q.replace(/[*,()]/g,'')}*`;
  return NextResponse.json(await supabaseQuery(filters.select ? 'subscriptions':'subscriptions',filters));
 } catch(error){ return NextResponse.json({error:error instanceof Error?error.message:'Catalog unavailable'},{status:503}); }
}
