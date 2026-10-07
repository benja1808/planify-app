// Local PIN gateway. Credentials live outside the web root.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const CONFIG = path.join(os.homedir(), '.planify-private', 'maintenance.json');
const TTL = 8 * 60 * 60 * 1000;
const PREFIX = '/api/maintenance/supabase';
const allowed = p => /^\/rest\/v1\/(mantenimiento_equipos|mantenimiento_trabajos|rpc\/mantenimiento_(consumo|reservar))$/.test(p) || /^\/storage\/v1\/object\/(?:sign\/|authenticated\/)?mantenimiento(?:\/[^?]*)?$/.test(p);
function createGateway(config, upstream = fetch, dependencies = {}) {
    const clock = dependencies.clock || Date.now;
    const sessions = new Map(), attempts = new Map();
    let token, tokenUntil = 0, refreshing;
    const auth = dependencies.auth || createClient(config.url, config.key, {auth:{persistSession:false,autoRefreshToken:false}});
    async function getToken() {
        if (token && tokenUntil > clock()) return token;
        if (!refreshing) refreshing = (async () => {
            const {data,error} = await auth.auth.signInWithPassword({email:config.email,password:config.password});
            if (error) throw new Error('No se pudo conectar el servidor con Supabase.');
            token = data.session.access_token;
            tokenUntil = data.session.expires_at * 1000 - 60000;
            return token;
        })().finally(() => { refreshing = null; });
        return refreshing;
    }
    const send = (res, status, body) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body));};
    return async function handle(req,res) {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (!url.pathname.startsWith('/api/maintenance/')) return false;
        const origin = `http://${req.headers.host}`;
        const peer = req.socket.remoteAddress;
        if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) || !/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '') || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
            send(res,403,{message:'Origen no permitido.'}); return true;
        }
        const now = clock();
        for (const [key,value] of sessions) if (value.expires <= now) sessions.delete(key);
        for (const [key,value] of attempts) if (value.until <= now) attempts.delete(key);
        const cookie = /(?:^|;\s*)planify_maintenance=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        const session = sessions.get(cookie);
        try {
            if (url.pathname === '/api/maintenance/login' && req.method === 'POST') {
                const ip = req.socket.remoteAddress;
                const rate = attempts.get(ip) || {count:0,until:now+15*60*1000};
                if (rate.count >= 5) {send(res,429,{message:'Demasiados intentos. Espera 15 minutos.'}); return true;}
                const chunks=[]; let size=0;
                for await (const c of req) {size+=c.length; if(size>1024) throw new Error('Solicitud demasiado grande.'); chunks.push(c);}
                const body=JSON.parse(Buffer.concat(chunks).toString());
                const expected=Object.hasOwn(config.pins,body.role) ? config.pins[body.role] : null;
                const actual=crypto.scryptSync(String(body.pin || ''),config.salt,32).toString('hex');
                if (!expected || !crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) {
                    rate.count++; attempts.set(ip,rate); send(res,401,{message:'PIN incorrecto.'}); return true;
                }
                await getToken();
                attempts.delete(ip); if(cookie) sessions.delete(cookie);
                const id=crypto.randomBytes(32).toString('hex');
                sessions.set(id,{role:body.role,expires:now+TTL});
                res.setHeader('Set-Cookie',`planify_maintenance=${id}; HttpOnly; SameSite=Strict; Path=/api/maintenance; Max-Age=${TTL/1000}`);
                send(res,200,{role:body.role}); return true;
            }
            if (url.pathname === '/api/maintenance/logout' && req.method === 'POST') {
                if(cookie) sessions.delete(cookie);
                res.setHeader('Set-Cookie','planify_maintenance=; HttpOnly; SameSite=Strict; Path=/api/maintenance; Max-Age=0');
                send(res,200,{}); return true;
            }
            if (!session) {send(res,401,{message:'Vuelve a ingresar a Planify con tu PIN.'}); return true;}
            if (url.pathname === '/api/maintenance/session' && req.method === 'GET') {send(res,200,{role:session.role}); return true;}
            const targetPath=url.pathname.slice(PREFIX.length);
            if (!url.pathname.startsWith(PREFIX+'/') || !allowed(targetPath) || !['GET','POST','PATCH','DELETE'].includes(req.method)) {send(res,403,{message:'Operación no permitida.'}); return true;}
            const chunks=[]; let size=0;
            for await (const c of req) {size+=c.length; if(size>22*1024*1024) throw new Error('Archivo demasiado grande.'); chunks.push(c);}
            const headers={apikey:config.key,Authorization:`Bearer ${await getToken()}`};
            for(const key of ['content-type','prefer','range','range-unit','x-upsert']) if(req.headers[key]) headers[key]=req.headers[key];
            const response=await upstream(config.url+targetPath+url.search,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,signal:AbortSignal.timeout(60000),redirect:'error'});
            res.writeHead(response.status,{'Content-Type':response.headers.get('content-type') || 'application/json','Cache-Control':'no-store',...(response.headers.get('content-range')?{'Content-Range':response.headers.get('content-range')}:{})});
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch(error) {send(res,503,{message:error.message || 'Servidor no disponible.'});}
        return true;
    };
}
module.exports={createGateway,allowed};
if(require.main === module) {
    if(!fs.existsSync(CONFIG)) throw new Error('Falta configurar '+CONFIG);
    process.env.HOST='127.0.0.1';
    process.env.PORT=process.env.PORT || '4173';
    process.env.DISABLE_PUSH='1';
    require('./server.js');
}
