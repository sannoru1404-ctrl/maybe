import { z } from 'zod';
const env = z.object({ SUPABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) });
export function supabaseConfig(){ return env.parse(process.env); }
export async function supabaseQuery<T>(table:string, params:Record<string,string>={}):Promise<T[]> {
 const c=supabaseConfig(); const url=new URL(`/rest/v1/${table}`,c.SUPABASE_URL); Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
 const response=await fetch(url,{headers:{apikey:c.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}`},cache:'no-store'});
 if(!response.ok) throw new Error(`Database request failed: ${response.status}`); return response.json() as Promise<T[]>;
}
