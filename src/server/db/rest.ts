export async function rest<T>(table:string, init:RequestInit & { query?:Record<string,string>} = {}):Promise<T>{
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Supabase is not configured');
 const u=new URL(`/rest/v1/${table}`,base);Object.entries(init.query??{}).forEach(([k,v])=>u.searchParams.set(k,v));
 const headers=new Headers(init.headers);headers.set('apikey',key);headers.set('Authorization',`Bearer ${key}`);headers.set('Content-Type','application/json');headers.set('Accept-Profile','subshare');headers.set('Content-Profile','subshare');
 const r=await fetch(u,{...init,headers,cache:'no-store'});if(!r.ok)throw new Error(`Database request failed: ${r.status}`);return r.status===204?undefined as T:await r.json();
}
