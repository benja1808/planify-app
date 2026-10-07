const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const {createGateway}=require('../../maintenance-server.cjs');
test('PIN sessions expire, revoke, reject cross-origin and block brute force',async()=>{
    let now=Date.now(),calls=0;
    const config={url:'https://example.supabase.co',key:'public',email:'technical',password:'secret',salt:'test',pins:{admin:crypto.scryptSync('1234','test',32).toString('hex')}};
    const handle=createGateway(config,async()=>{calls++;return new Response('[]');},{clock:()=>now,auth:{auth:{signInWithPassword:async()=>({data:{session:{access_token:'server-only',expires_at:Math.floor(now/1000)+3600}}})}}});
    const server=http.createServer((req,res)=>handle(req,res));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api/maintenance`;
    const login=(pin='1234',extra={})=>fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({role:'admin',pin})});
    try {
        assert.equal((await fetch(base+'/session')).status,401);
        assert.equal((await login('1234',{Origin:'https://foreign.example'})).status,403);
        const good=await login();assert.equal(good.status,200);
        const cookie=good.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);
        const headers={Cookie:cookie.split(';')[0]};
        assert.deepEqual(await good.json(),{role:'admin'});
        assert.equal((await fetch(base+'/session',{headers})).status,200);
        assert.equal((await fetch(base+'/supabase/rest/v1/trabajadores',{headers})).status,403);
        assert.equal(calls,0);
        assert.equal((await fetch(base+'/supabase/rest/v1/mantenimiento_equipos',{headers})).status,200);
        assert.equal(calls,1);
        now+=8*60*60*1000+1;
        assert.equal((await fetch(base+'/session',{headers})).status,401);
        const renewed=await login();const renewedHeaders={Cookie:renewed.headers.get('set-cookie').split(';')[0]};
        await fetch(base+'/logout',{method:'POST',headers:renewedHeaders});
        assert.equal((await fetch(base+'/session',{headers:renewedHeaders})).status,401);
        for(let i=0;i<5;i++) assert.equal((await login('wrong')).status,401);
        assert.equal((await login()).status,429);
        now+=15*60*1000+1;
        assert.equal((await login()).status,200);
    } finally { await new Promise(resolve=>server.close(resolve)); }
});
