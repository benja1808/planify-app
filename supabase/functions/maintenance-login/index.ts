import { createClient } from 'npm:@supabase/supabase-js@2.99.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
Deno.serve(async req => {
  const reply = (status: number, body: unknown) => Response.json(body, {status, headers: cors});
  if (req.method === 'OPTIONS') return new Response(null, {headers:cors});
  if (req.method !== 'POST') return reply(405, {message:'Método no permitido.'});
  try {
    const raw = await req.text();
    if (raw.length > 1024) return reply(400, {message:'Solicitud inválida.'});
    const {rut,pin} = JSON.parse(raw);
    if (typeof rut !== 'string' || rut.length > 20 || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return reply(400,{message:'Ingresa tu RUT y PIN de cuatro dígitos.'});
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:worker,error} = await admin.rpc('mantenimiento_validar_trabajador',{p_rut:rut,p_pin:pin,p_ip:req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'});
    if (error) return reply(503,{message:'No se pudo validar el acceso. Intenta nuevamente.'});
    if (!worker) return reply(401,{message:'RUT o PIN incorrecto. El PIN es tu día y mes de nacimiento (DDMM).'});
    // generateLink never sends mail. Only server-validated workers receive a session.
    const {data:link,error:linkError} = await admin.auth.admin.generateLink({type:'magiclink',email:`maintenance-${worker}@planify.invalid`});
    if (linkError || !link.user || !link.properties?.hashed_token) throw new Error('generate-link:'+(linkError?.code || 'missing-data'));
    const {error:updateError} = await admin.auth.admin.updateUserById(link.user.id,{app_metadata:{maintenance_worker_id:worker}});
    if (updateError) throw new Error('update-user:'+updateError.code);
    const client = createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error:sessionError} = await client.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'email'});
    if (sessionError || !data.session) throw new Error('verify-otp:'+(sessionError?.code || 'missing-session'));
    return reply(200,{access_token:data.session.access_token,refresh_token:data.session.refresh_token});
  } catch (error) { console.error('maintenance-login',error instanceof Error ? error.message : 'unknown'); return reply(503,{message:'No se pudo abrir Mantenimiento. Vuelve a intentarlo.'}); }
});
