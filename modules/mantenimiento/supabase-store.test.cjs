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
