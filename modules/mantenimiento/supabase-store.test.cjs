const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function setup(failUpload=false, failRemove=false) {
    const events=[];
    const ok = {data:{id:'test'},error:null};
    const client={
        rpc:async name=>{events.push(name);return ok;},
        storage:{from:()=>({
            upload:async()=>{events.push('upload');return failUpload?{error:new Error('upload failed')}:ok;},
            remove:async()=>{events.push('remove');return failRemove?{error:new Error('remove failed')}:ok;}
        })},
        from:()=>({
            update:value=>({eq:()=>{
                events.push(value.status);
                return {then:resolve=>resolve(ok),select:()=>({single:async()=>ok})};
            }}),
            delete:()=>({eq:async()=>{events.push('delete-metadata');return ok;}})
        })
    };
    const context={location:{origin:'http://127.0.0.1:4173'},window:{supabase:{createClient:()=>client},sessionStorage:{}},crypto};
    vm.runInNewContext(fs.readFileSync(__dirname+'/supabase-store.js','utf8'),context);
    const api=context.window.MaintenanceCloud;api.configure('url','publishable');
    return {api,events};
}
const job={id:'test',equipmentId:'eq',category:'END',title:'Prueba',work:'Inspección',photos:[{name:'a.png',blob:new Blob(['photo'],{type:'image/png'})}]};
test('reserves before upload and only marks ready afterwards',async()=>{
    const {api,events}=setup();await api.saveJob(job);
    assert.deepEqual(events,['mantenimiento_reservar','upload','ready']);
});
test('failed upload cleans photos before deleting manifest',async()=>{
    const {api,events}=setup(true);await assert.rejects(api.saveJob(job),/upload failed/);
    assert.deepEqual(events,['mantenimiento_reservar','upload','deleting','remove','delete-metadata']);
});
test('failed cleanup preserves manifest for retry',async()=>{
    const {api,events}=setup(true,true);await assert.rejects(api.saveJob(job),/carga incompleta/);
    assert.equal(events.includes('delete-metadata'),false);
});
test('failed photo deletion never deletes metadata',async()=>{
    const {api,events}=setup(false,true);await assert.rejects(api.deleteJob({id:'test',photos:[{path:'test/a.png'}]}),/remove failed/);
    assert.deepEqual(events,['deleting','remove']);
});

test('web uses an isolated authenticated client without the localhost gateway',async()=>{
 const calls=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'worker'}}}})}};
 const context={location:{origin:'https://planifyappl.netlify.app',hostname:'planifyappl.netlify.app'},window:{supabase:{createClient:(url,key,options)=>{calls.push({url,options});return client;}}},fetch:()=>{throw Error('Local gateway must not be called');}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/supabase-store.js','utf8'),context);
 const api=context.window.MaintenanceCloud;api.configure('https://project.supabase.co','public');
 assert.equal((await api.session()).id,'worker');
 assert.equal(calls[0].url,'https://project.supabase.co');
 assert.equal(calls[0].options.auth.storageKey,'planify-maintenance-auth');
});

test('restored web planner exchanges the validated token and keeps the management role', async()=>{
 let session=null, sent;
 const client={auth:{getSession:async()=>({data:{session}}),setSession:async()=>{session={user:{id:'planner',app_metadata:{maintenance_role:'admin',maintenance_planner_session:'hash'}}};return {};}}};
 const context={window:{supabase:{createClient:()=>client}},location:{hostname:'planifyappl.netlify.app'},localStorage:{getItem:()=>JSON.stringify({rol:'admin',token:'session-token'})},fetch:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({access_token:'access',refresh_token:'refresh'})};}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/supabase-store.js','utf8'),context);
 const api=context.window.MaintenanceCloud;api.configure('https://project.supabase.co','public');
 assert.equal((await api.session()).role,'admin');
 assert.equal(sent.body.token,'session-token');
 assert.match(sent.url,/maintenance-planner-login$/);
});
