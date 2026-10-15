const test = require('node:test');
const assert = require('node:assert/strict');
const createStore = require('./route-executions-store.js');
const vm = require('node:vm');
const fs = require('node:fs');
function memory(initial={}) {const map=new Map(Object.entries(initial)); return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};}
function setup(legacy={}) {const storage=memory({planify_rutas_ejecuciones:JSON.stringify(legacy)});const session=memory();let i=0;return {storage,session,store:createStore(storage,session,()=>`new-${++i}`)};}
const entry=(id,ot)=>({id,rutaIdx:4,ot,estado:'activa',componentesEstado:{},mediciones:{}});
test('legacy migration preserves original OT and local measurements',()=>{const {store}=setup({4:{ot:'100',mediciones:{'0.0':{vibracion:1.2}}}});assert.equal(store.all().length,1);assert.equal(store.selected(4).mediciones['0.0'].vibracion,1.2);assert.ok(store.selected(4)._new);});
test('two OT keep independent measurements across selection and reload',()=>{const {store,storage,session}=setup();store.put(4,entry('a','100'),{choose:true});store.put(4,entry('b','200'),{choose:true});store.select(4,'a');store.put(4,{...store.selected(4),mediciones:{'0.0':{vibracion:9}}});const reloaded=createStore(storage,session,()=> 'unused');assert.equal(reloaded.selected(4).id,'a');assert.deepEqual(reloaded.get('b').mediciones,{});assert.equal(reloaded.all().length,2);});
test('selection is separate between browser tabs',()=>{const {store,storage}=setup();store.put(4,entry('a','100'));store.put(4,entry('b','200'));const second=createStore(storage,memory(),()=> 'unused');store.select(4,'a');second.select(4,'b');assert.equal(store.selected(4).id,'a');assert.equal(second.selected(4).id,'b');});
test('duplicate OT rejected without replacing another execution',()=>{const {store}=setup();store.put(4,entry('a','OT100'));assert.throws(()=>store.put(4,entry('b',' ot100 ')),/Ya hay/);assert.equal(store.all().length,1);});
test('refresh retains every remote OT and unsynced local work',()=>{const {store}=setup();store.put(4,entry('a','100'));store.merge([entry('a','100'),entry('b','200')]);assert.equal(store.all().length,2);assert.ok(store.get('a')._dirty);assert.equal(store.get('b')._dirty,false);});
test('acknowledging an older save never clears a newer pending change',()=>{const {store}=setup();const old=store.put(4,entry('a','100'));store.put(4,{...old,mediciones:{x:3}});store.acknowledged('a',old._revision);assert.ok(store.get('a')._dirty);assert.equal(store.get('a').mediciones.x,3);});
test('stale refresh cannot overwrite changes acknowledged while fetching',()=>{const {store}=setup();const initial=store.put(4,entry('a','100'));store.acknowledged('a',initial._revision);const snapshot={a:initial._revision};const newer=store.put(4,{...initial,mediciones:{x:7}});store.acknowledged('a',newer._revision);store.merge([entry('a','100')],snapshot);assert.equal(store.get('a').mediciones.x,7);});
test('closing one OT preserves the other and blocks stale resurrection',()=>{const {store}=setup();store.put(4,entry('a','100'),{choose:true});store.put(4,entry('b','200'));store.remove('a');store.merge([entry('a','100'),entry('b','200')]);assert.equal(store.all().length,1);assert.equal(store.get('b').ot,'200');assert.equal(store.selected(4),null);assert.throws(()=>store.put(4,entry('a','100')),/cerrada/);});
const source=fs.readFileSync('app.js','utf8');
function block(start,end) {return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function integrated(fail=false) {
 const env=setup();const calls=[];
 const client={from(table){let payload,id;return {update(p){payload=p;return this;},upsert(rows){payload=rows[0];id=payload.id;return this;},eq(k,v){if(k==='id')id=v;return this;},select(){return this;},async single(){calls.push({id,payload});return {data:fail?null:{id},error:fail?new Error('offline'):null};}};}};
 const ctx={window:{RouteExecutionStore:env.store,RouteExecutionSync:createStore.sync,supabaseClient:client},navigator:{onLine:true},esRutaRequerimientos:()=>false,obtenerRutaVibracion:()=>({nombre:'Ruta',unidad:'U4'}),console};
 vm.createContext(ctx);
 vm.runInContext(block('function getRutasEjecuciones()','// ── Sync con Supabase:'),ctx);
 vm.runInContext(block('async function _pushEjecucionASupabase','// Trae todas las ejecuciones ACTIVAS'),ctx);
 vm.runInContext(block('async function _marcarEjecucionFinalizada','// --- SISTEMA DE NAVEGACIÓN'),ctx);
 return {...env,ctx,calls};
}
test('real sync helper sends and acknowledges only the requested UUID',async()=>{const {store,ctx,calls}=integrated();const a=store.put(4,{...entry('a','100'),_new:true});store.put(4,entry('b','200'),{choose:true});await ctx._pushEjecucionASupabase(4,a);assert.equal(calls[0].id,'a');assert.equal(calls[0].payload.ot,'100');assert.equal(store.get('a')._dirty,false);assert.equal(store.get('b')._dirty,true);});
test('sync failure retains the local execution for retry',async()=>{const {store,ctx}=integrated(true);const a=store.put(4,{...entry('a','100'),_new:true});await assert.rejects(()=>ctx._pushEjecucionASupabase(4,a),/offline/);assert.ok(store.get('a')._dirty);});
test('closing captured OT ignores a later switch to another OT',async()=>{const {store,ctx,calls}=integrated();const a=store.put(4,entry('a','100'));store.put(4,entry('b','200'),{choose:true});await ctx._marcarEjecucionFinalizada(4,'cerrada',a);assert.ok(calls.every(c=>c.id==='a'));assert.equal(calls.at(-1).payload.estado,'cerrada');assert.equal(store.get('b').estado,'activa');});
test('daily plans use date and OT together as their identity',()=>{
 const {store}=setup();
 const day=(id,date)=>({...entry(id,''),componentesEstado:{__vibDiaria:{fecha:date},__requerimientoEquipos:[{nombre:'Bomba',componentes:[{equipo_id:'e1'}]}]}});
 store.put(-2,day('monday','2026-10-05'));store.put(-2,day('tuesday','2026-10-06'));
 assert.equal(store.list(-2).length,2);
 assert.throws(()=>store.put(-2,day('duplicate','2026-10-06')),/Ya hay/);
 store.acknowledged('monday',store.get('monday')._revision);store.acknowledged('tuesday',store.get('tuesday')._revision);
 store.merge(store.all());assert.equal(store.get('monday').componentesEstado.__requerimientoEquipos[0].nombre,'Bomba');
});

// ── Captura simultánea: varias personas guardando la misma OT ───────────────
// Servidor simulado con la misma semántica que rutas_ejecucion_aplicar (SQL).
function fakeServer(row, { conRpc = true } = {}) {
 const server = { row: JSON.parse(JSON.stringify(row)) };
 const COLS = ['componentes_estado','componentes_at','observaciones','mediciones'];
 const aplicar = (set, del) => { if (server.row.estado !== 'activa') return null; COLS.forEach(c => { server.row[c] = { ...(server.row[c] || {}), ...(set[c] || {}) }; (del[c] || []).forEach(k => delete server.row[c][k]); }); return JSON.parse(JSON.stringify(server.row)); };
 server.client = {
  ...(conRpc ? { async rpc(fn, args) { if (server.duranteEnvio) { const f = server.duranteEnvio; server.duranteEnvio = null; await f(); } const r = aplicar(args.p_set, args.p_del); return { data: r ? [r] : [], error: null }; } } : {}),
  from() { let mode = 'select', payload; const q = {
   select() { return q; }, eq() { return q; },
   update(p) { mode = 'update'; payload = p; return q; },
   async single() {
    if (mode === 'update') { Object.assign(server.row, JSON.parse(JSON.stringify(payload))); return { data: { id: server.row.id }, error: null }; }
    return { data: JSON.parse(JSON.stringify(server.row)), error: null };
   } }; return q; }
 };
 return server;
}
function device(server) {
 const env = setup();
 const ctx = { window: { RouteExecutionStore: env.store, RouteExecutionSync: createStore.sync, supabaseClient: server.client }, navigator: { onLine: true },
  esRutaRequerimientos: () => false, normalizarEjecucionRequerimientos: () => {}, obtenerRutaVibracion: () => ({ nombre: 'Ruta', unidad: 'U3' }), console };
 vm.createContext(ctx);
 vm.runInContext(block('function getRutasEjecuciones()', '// ── Sync con Supabase:'), ctx);
 vm.runInContext(block('async function _pushEjecucionASupabase', '// Trae todas las ejecuciones ACTIVAS'), ctx);
 // Ambos parten desde la misma versión descargada del servidor.
 env.store.merge([ctx._mapearFilaEjecucion(JSON.parse(JSON.stringify(server.row)))]);
 const save = (key, med) => { const ej = env.store.get('ot1'); return env.store.put(3, { ...ej, mediciones: { ...ej.mediciones, [key]: med }, componentesEstado: { ...ej.componentesEstado, [key]: 'listo' } }); };
 return { ...env, ctx, save, push: () => ctx._pushEjecucionASupabase(3, env.store.get('ot1')) };
}
const baseRow = { id: 'ot1', ruta_idx: 3, ot: '2002183982', estado: 'activa', componentes_estado: {}, componentes_at: {}, observaciones: { '9.9': 'previa' }, mediciones: { '9.9': { vibracion: '1' } } };

for (const conRpc of [true, false]) {
 const modo = conRpc ? 'con la función SQL' : 'con el respaldo sin función SQL';
 test(`dos técnicos guardando a la vez no se borran (${modo})`, async () => {
  const server = fakeServer(baseRow, { conRpc });
  const brandon = device(server), luis = device(server);
  brandon.save('0.0', { vibracion: '0,88' });
  luis.save('0.1', { vibracion: '0,56' });
  if (conRpc) await Promise.all([brandon.push(), luis.push()]);
  else { await brandon.push(); await luis.push(); }
  assert.equal(server.row.mediciones['0.0'].vibracion, '0,88');
  assert.equal(server.row.mediciones['0.1'].vibracion, '0,56');
  assert.equal(server.row.mediciones['9.9'].vibracion, '1');
  assert.equal(server.row.observaciones['9.9'], 'previa');
  // El que guardó último ya ve lo del compañero; el otro lo ve al refrescar.
  assert.ok(luis.store.get('ot1').mediciones['0.0']);
  brandon.store.merge([brandon.ctx._mapearFilaEjecucion(server.row)]);
  assert.ok(brandon.store.get('ot1').mediciones['0.1']);
  assert.equal(brandon.store.get('ot1')._dirty, false);
 });
}
test('refrescar con cambios pendientes combina lo local con lo del compañero', () => {
 const server = fakeServer(baseRow);
 const a = device(server);
 a.save('0.0', { vibracion: '2' });                       // pendiente (sin conexión)
 server.row.mediciones['0.1'] = { vibracion: '5' };       // el compañero ya subió el suyo
 a.store.merge([a.ctx._mapearFilaEjecucion(server.row)]);
 const ej = a.store.get('ot1');
 assert.equal(ej.mediciones['0.0'].vibracion, '2');
 assert.equal(ej.mediciones['0.1'].vibracion, '5');
 assert.equal(ej._dirty, true);
});
test('lo editado mientras se enviaba no se pierde y queda pendiente', async () => {
 const server = fakeServer(baseRow);
 const a = device(server);
 a.save('0.0', { vibracion: '1,1' });
 server.duranteEnvio = async () => { a.save('0.1', { vibracion: '2,2' }); };  // edita durante el envío
 await a.push();
 const ej = a.store.get('ot1');
 assert.equal(ej.mediciones['0.1'].vibracion, '2,2');
 assert.equal(ej._dirty, true);
 await a.push();
 assert.equal(server.row.mediciones['0.1'].vibracion, '2,2');
 assert.equal(server.row.mediciones['0.0'].vibracion, '1,1');
 assert.equal(a.store.get('ot1')._dirty, false);
});
test('quitar una observación borra solo esa en el servidor', async () => {
 const server = fakeServer({ ...baseRow, observaciones: { '9.9': 'previa', '1.0': 'otra' } });
 const a = device(server);
 const ej = a.store.get('ot1');
 const obs = { ...ej.observaciones }; delete obs['9.9'];
 a.store.put(3, { ...ej, observaciones: obs });
 await a.push();
 assert.equal('9.9' in server.row.observaciones, false);
 assert.equal(server.row.observaciones['1.0'], 'otra');
});
