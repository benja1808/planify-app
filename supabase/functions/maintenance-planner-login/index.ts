import { createClient } from 'npm:@supabase/supabase-js@2.99.0';

const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Cache-Control':'no-store' };
Deno.serve(async req => {
  const reply = (status: number, body: unknown) => Response.json(body,{status,headers});
  if (req.method === 'OPTIONS') return new Response(null,{headers});
  if (req.method !== 'POST') return reply(405,{message:'Método no permitido.'});
  try {
    const raw = await req.text();
    if (raw.length > 1024) return reply(400,{message:'Solicitud inválida.'});
    const {token} = JSON.parse(raw);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return reply(401,{message:'Vuelve a ingresar con tu PIN de planificador.'});
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:role,error} = await client.rpc('planify_validar_sesion',{p_token:token});
    if (error) return reply(503,{message:'No se pudo validar la sesión.'});
    if (!['admin','administrador'].includes(role)) return reply(403,{message:'Se requiere una sesión vigente de planificador o administrador.'});
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const admin = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    // One identity per validated session; revocation is checked by RLS on every operation.
    const {data:link,error:linkError} = await admin.auth.admin.generateLink({type:'magiclink',email:`planner-${hash.slice(0,40)}@planify.invalid`});
    if (linkError || !link.user || !link.properties?.hashed_token) throw new Error('session');
    const {error:updateError} = await admin.auth.admin.updateUserById(link.user.id,{app_metadata:{maintenance_role:role,maintenance_planner_session:hash}});
    if (updateError) throw updateError;
    const {data,error:sessionError} = await client.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'email'});
    if (sessionError || !data.session) throw new Error('session');
    return reply(200,{access_token:data.session.access_token,refresh_token:data.session.refresh_token});
  } catch (_) { return reply(503,{message:'No se pudo abrir Mantenimiento. Intenta nuevamente.'}); }
});
