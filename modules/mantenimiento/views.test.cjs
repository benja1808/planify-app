const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/mantenimiento.js', 'utf8');
async function render(session, load, hostname='localhost') {
    const handlers = {};
    const unitButton = {dataset:{unit:'U1'}}, equipmentButton = {dataset:{equipment:'one'}};
    const host = {innerHTML: '', querySelector: id => ({addEventListener: (event, action) => {handlers[id] = action;}}), querySelectorAll: selector => selector === '[data-unit]' ? [unitButton] : selector === '[data-equipment]' ? [equipmentButton] : []};
    const context = {window: {MaintenanceCloud: {session, load}}, location: {hostname}, document: {body:{dataset:{view:'mantenimiento'}}}, URL:{revokeObjectURL(){}}, setTimeout, clearTimeout};
    vm.runInNewContext(source, context);
    context.window.PlanifyMantenimiento.render(host, []);
    await new Promise(resolve => setImmediate(resolve));
    return {host, handlers, context, unitButton, equipmentButton};
}
test('network failure offers retry instead of requesting a new PIN', async () => {
    let failed = true;
    const {host, handlers} = await render(async () => {if (failed) throw new TypeError('Failed to fetch'); return null;});
    assert.match(host.innerHTML, /No pudimos cargar Mantenimiento/);
    assert.match(host.innerHTML, /id="maint-retry"/);
    assert.doesNotMatch(host.innerHTML, /Failed to fetch|id="maint-relogin"/);
    failed = false;
    await handlers['#maint-retry']({});
    assert.match(host.innerHTML, /id="maint-relogin"/);
});
test('expired session requests PIN', async () => {
    const {host} = await render(async () => null);
    assert.match(host.innerHTML, /Activa tu acceso/);
    assert.doesNotMatch(host.innerHTML, /id="maint-retry"/);
});
test('authorization failure has a separate view', async () => {
    const {host} = await render(async () => ({}), async () => {throw {code:'42501'};});
    assert.match(host.innerHTML, /Acceso restringido/);
});
test('late response does not overwrite another section', async () => {
    let resolve;
    const {host, context} = await render(() => new Promise(r => {resolve = r;}));
    context.document.body.dataset.view = 'control';
    host.innerHTML = 'Otra pantalla';
    resolve(null);
    await new Promise(r => setImmediate(r));
    assert.equal(host.innerHTML, 'Otra pantalla');
});
test('overview includes five units and actual summary counts', async () => {
    const {host} = await render(async () => ({}), async () => ({equipment:[{id:'one',unit:'U1',name:'Bomba'}], jobs:[],usage:{used:0}}));
    assert.equal((host.innerHTML.match(/data-unit=/g) || []).length, 5);
    assert.match(host.innerHTML, /Equipos incorporados<\/span><strong>1/);
});

test('worker maintenance renders on the published web host', async () => {
 const {host} = await render(async () => ({id:'worker',role:'trabajador'}), async () => ({equipment:[],jobs:[],usage:{used:0}}), 'planifyappl.netlify.app');
 assert.equal((host.innerHTML.match(/data-unit=/g) || []).length,5);
 assert.match(host.innerHTML,/Mantenimiento/);
});

for (const role of ['trabajador','admin','ito']) {
 for (const open of [false,true]) {
  test(role+' sees correct controls for '+(open?'open':'closed')+' equipment',async()=>{
   const view=await render(async()=>({id:role,role}),async()=>({equipment:[{id:'one',unit:'U1',name:'Bomba',is_open:open}],jobs:[],usage:{used:0}}));
   view.unitButton.onclick(); await new Promise(r=>setImmediate(r));
   assert.equal(view.host.innerHTML.includes('id="maint-add"'),role==='admin');
   view.equipmentButton.onclick(); await new Promise(r=>setImmediate(r));
   assert.equal(view.host.innerHTML.includes('id="maint-toggle"'),role==='admin');
   assert.equal(view.host.innerHTML.includes('id="maint-editor" hidden'),!open);
   assert.match(view.host.innerHTML,/Registros del equipo/);
  });
 }
}

test('remote closure and reopening preserve selected photos and typed work', async()=>{
 const src=source.slice(source.indexOf('function bindDetail(current, jobs) {'),source.indexOf("on('maint-toggle'",source.indexOf('function bindDetail(current, jobs) {')))+'}';
 let timer; const photo={name:'foto.jpg'}; const fields=[{type:'file',files:[photo]},{type:'text',value:'Trabajo en curso'}];
 const nodes={'#maint-job':{querySelectorAll:()=>fields},'#maint-open-label':{},'#maint-closed':{},'#maint-editor':{},'#maint-save':{},'#maint-toggle':{}};
 let open=false;
 const ctx={generation:1,document:{body:{dataset:{view:'mantenimiento'}}},host:{querySelector:id=>nodes[id]},cloud:{equipmentState:async()=>({is_open:open})},setTimeout:fn=>{timer=fn},stateTimer:null};
 vm.runInNewContext(src+';this.bind=bindDetail;',ctx);
 ctx.bind({id:'one',is_open:true},[]);
 await timer(); assert.equal(nodes['#maint-save'].disabled,true);assert.equal(nodes['#maint-editor'].hidden,false);
 assert.equal(fields[0].files[0],photo);assert.equal(fields[1].value,'Trabajo en curso');
 open=true;await timer();assert.equal(nodes['#maint-save'].disabled,false);
 assert.equal(fields[0].files[0],photo);
});
