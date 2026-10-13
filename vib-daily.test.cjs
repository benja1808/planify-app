const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('./vib-daily-core.js');
const item=(str,x,y)=>({str,width:0,transform:[1,0,0,1,x,y]});
const header=['UBICACIÓN','ACTIVO','COMPONENTE','UBICACIÓN','Criticidad','DISPONIBILIDAD DE','OBSERVACIONES'].map((s,i)=>item(s,50+i*100,500));
const row=(y,code,status,observation='')=>['UNIDAD 1','BOMBA A','MOTOR',code,'',status,observation].map((s,i)=>item(s,50+i*100,y));
test('blank PDF availability requests an explicit choice and preserves existing Yes/No values',()=>{
    const pages=[{width:700,items:[...header,...row(400,'2893-01-A--M01',''),...row(350,'2893-01-B--M01','NO'),...row(300,'2893-01-C--M01','SI')]}];
    assert.throws(()=>core.parsePages(pages),e=>e.code==='BLANK_AVAILABILITY');
    assert.deepEqual(core.parsePages(pages,{blankAvailability:true})[0].componentes.map(c=>c.disponible),[true,false,true]);
    assert.deepEqual(core.parsePages(pages,{blankAvailability:false})[0].componentes.map(c=>c.disponible),[false,false,true]);
    const pending=core.parsePages(pages,{blankAvailability:'pending'})[0].componentes;
    assert.deepEqual(pending.map(c=>c.disponibilidadPendiente),[true,false,false]);
    assert.deepEqual(pending.map(c=>c.disponible),[false,false,true]);
    const invalid=[{width:700,items:[...header,...row(400,'2893-01-A--M01','PENDIENTE')]}];
    assert.throws(()=>core.parsePages(invalid,{blankAvailability:true}),/Disponibilidad no reconocida/);
});
const recoveryMapping={unidad:3,activo:2,nombre:1,ubicacion_tecnica:0,disponible:4,ot:5,observacionOperaciones:6};
const recoveryRow='2893-01-ABC01-AP101--M01\tMotor\tBomba\tUnidad 1\tSí\t001234\tRevisar antes de medir';
test('guided recovery imports reordered columns and preserves OT, exact KKS and observations',()=>{
    const result=core.parseRecovery(recoveryRow+'\n'+recoveryRow.replace('--M01','-KP01').replace('Sí','NO'),recoveryMapping);
    assert.equal(result.length,1);assert.equal(result[0].ot,'001234');
    assert.equal(result[0].componentes[0].ubicacion_tecnica,'2893-01-ABC01-AP101--M01');
    assert.equal(result[0].componentes[0].observacionOperaciones,'Revisar antes de medir');
    assert.equal(result[0].componentes[0].disponible,true);
    assert.equal(result[0].componentes[1].disponible,false);
});
test('guided recovery rejects incomplete mappings and identifies bad rows without partial import',()=>{
    assert.throws(()=>core.parseRecovery(recoveryRow,{...recoveryMapping,activo:-1}),/obligatorias/);
    assert.throws(()=>core.parseRecovery(recoveryRow,{...recoveryMapping,activo:1}),/diferente/);
    assert.throws(()=>core.parseRecovery(recoveryRow+'\n'+recoveryRow,recoveryMapping),/Fila 2.*repetida/);
    assert.throws(()=>core.parseRecovery(recoveryRow.replace('Sí','Pendiente'),recoveryMapping),/Fila 1.*Sí o No/);
    assert.throws(()=>core.parseRecovery(recoveryRow.replace('Bomba',''),recoveryMapping),/Fila 1.*completa/);
    assert.throws(()=>core.parseRecovery(recoveryRow.replace('2893-01-ABC01-AP101--M01','???'),recoveryMapping),/ubicación técnica/);
    assert.throws(()=>core.parseRecovery('',recoveryMapping),/al menos/);
    assert.equal(core.parseRecovery(recoveryRow,{...recoveryMapping,ot:-1})[0].ot,'');
});
test('recovery text preserves unknown headings and all rows for user review in reading order',()=>{
    const pages=[{items:[item('NO',300,300),item('Título desconocido',20,500),item('Motor',100,300),item('Bomba',20,300)]},{items:[item('Última fila',20,400)]}];
    assert.equal(core.recoveryText(pages),'Título desconocido\nBomba\tMotor\tNO\nÚltima fila');
    assert.equal(core.recoveryText([{items:[]}]),'');
});
test('PDF accepts full headings, optional columns and recalibrates repeated page headers',()=>{
    const full=['Ubicación','Activo','Componente','Ubicación técnica','Disponibilidad de entrega (Sí / No)','Observaciones de Operaciones'];
    const page=(width,shift,code,status)=>({width,items:[
        ...full.map((s,i)=>item(s,shift+i*100,500)),
        ...['UNIDAD 1','BOMBA A','MOTOR',code,status,'Revisar antes de medir'].map((s,i)=>item(s,shift+i*100,475))
    ]});
    const result=core.parsePages([page(700,50,'2893-01-ABC01-AP101-KP01','Sí'),page(900,200,'2893-01-ABC01-AP101--M01','NO')]);
    assert.equal(result.length,1);
    assert.equal(result[0].componentes.length,2);
    assert.equal(result[0].componentes[0].disponible,true);
    assert.equal(result[0].componentes[1].disponible,false);
    assert.equal(result[0].componentes[0].observacionOperaciones,'Revisar antes de medir');
});
test('PDF accepts availability heading without DE and reports empty text as a scan',()=>{
    const variant=header.map(i=>i.str==='DISPONIBILIDAD DE'?{...i,str:'DISPONIBILIDAD'}:i);
    assert.equal(core.parsePages([{width:700,items:[...variant,...row(400,'2893-01-ABC01-AP101-KP01','SI')]}]).length,1);
    assert.throws(()=>core.parsePages([{width:700,items:[]}]),/legible/);
});
test('compact first row excludes the second header line from OT and technical code',()=>{
    const shifted=values=>values.map(i=>({...i,transform:[1,0,0,1,i.transform[4]+100,i.transform[5]]}));
    const result=core.parsePages([{width:800,items:[item('ORDEN DE',50,505),item('TRABAJO',50,496),...shifted(header),item('TÉCNICA',450,496),item('2002185120',50,471),...shifted(row(471,'2893-33-PAC01-AP102-KP01','SI')),item('2002185120',50,455),...shifted(row(455,'2893-33-PAC01-AP102--M01','SI'))]}]);
    assert.equal(result.length,1);assert.equal(result[0].ot,'2002185120');assert.equal(result[0].componentes.length,2);
    assert.equal(result[0].componentes[0].ubicacion_tecnica,'2893-33-PAC01-AP102-KP01');
});
test('optional PDF order column is read as a string and grouped with its equipment',()=>{
    const shifted=values=>values.map(i=>({...i,transform:[1,0,0,1,i.transform[4]+100,i.transform[5]]}));
    const result=core.parsePages([{width:800,items:[item('ORDEN DE',50,500),...shifted(header),item('2002185124',50,400),...shifted(row(400,'2893-01-GAA02-AN101--M01','SI'))]}]);
    assert.equal(result[0].ot,'2002185124');assert.equal(result[0].nombre,'BOMBA A');assert.equal(result[0].componentes[0].disponible,true);
});
test('reimport fills missing OT without duplicates and does not overwrite a conflicting OT',()=>{
    const old=[{nombre:'Bomba',ot:'',componentes:[{ubicacion_tecnica:'UT-1'}]}];
    const incoming=[{nombre:'Bomba',ot:'2002185124',componentes:[{ubicacion_tecnica:'UT-1'}]}];
    const merged=core.mergeImport(old,incoming);assert.equal(merged.updated,1);assert.equal(merged.added,0);assert.equal(merged.equipment[0].ot,'2002185124');assert.equal(old[0].ot,'');
    assert.equal(core.mergeImport(merged.equipment,incoming).updated,0);
    assert.throws(()=>core.mergeImport(merged.equipment,[{...incoming[0],ot:'OTHER'}]),/OT diferente/);
    assert.equal(merged.equipment[0].ot,'2002185124');
});
test('PDF groups components across pages and preserves NO and operations instructions',()=>{
    const result=core.parsePages([{width:700,items:[...header,...row(400,'2893-01-ABC01-AP101-KP01','SI')]},{width:700,items:row(500,'2893-01-ABC01-AP101--M01','NO','En montaje')}]);
    assert.equal(result.length,1);assert.equal(result[0].componentes.length,2);assert.equal(result[0].componentes[1].disponible,false);assert.equal(result[0].componentes[1].observacionOperaciones,'En montaje');
});
test('PDF rejects duplicates, missing availability, unknown formats and empty scans',()=>{
    assert.throws(()=>core.parsePages([{width:700,items:[...header,...row(400,'2893-01-ABC01-AP101-KP01','SI'),...row(350,'2893-01-ABC01-AP101-KP01','SI')]}]),/repetida/);
    assert.throws(()=>core.parsePages([{width:700,items:[...header,...row(400,'2893-01-ABC01-AP101-KP01','')]}]),/filas/);
    assert.throws(()=>core.parsePages([{width:700,items:row(400,'2893-01-ABC01-AP101-KP01','SI')}]),/tabla/);
    assert.throws(()=>core.parsePages([]),/legible/);
});
const comp=code=>({nombre:'Motor',ubicacion_tecnica:code});
test('route lookup requires all exact KKS and refuses ambiguous component mappings',()=>{
    const eq={componentes:[comp('A--M01'),comp('B-KP01')]};
    const routes=[{idx:0,equipos:[{componentes:[comp('A-M01'),comp('B-KP01')]}]},{idx:1,equipos:[eq]}];
    assert.deepEqual(core.candidates(eq,routes).map(r=>r.idx),[1]);assert.deepEqual(core.mapping(eq,routes[1]),['0.0','0.1']);
    assert.throws(()=>core.mapping(eq,{equipos:[eq,eq]}),/única/);
});
function setup(){
    const source={id:'source',rutaIdx:5,mediciones:{'2.1':{vibracion:1}},componentesEstado:{'2.1':'listo'}};
    const daily={id:'daily',rutaIdx:-2,requerimientoEquipos:[{componentes:[comp('M'),{...comp('B'),disponible:false}],enlace:{ejecucionId:'source',componentKeys:['2.1','2.2']}}],mediciones:{},componentesEstado:{__vibDiaria:{fecha:'2026-10-06'}}};
    return {source,daily,get:id=>id==='source'?source:null};
}
test('daily reads source live without duplicating or mutating source metadata',()=>{
    const {source,daily,get}=setup();const view=core.hydrate(daily,get);
    assert.equal(view.mediciones['0.0'].vibracion,1);assert.equal(view.componentesEstado['0.0'],'listo');
    assert.equal(view.componentesEstado.__vibDiaria.fecha,'2026-10-06');assert.deepEqual(daily.mediciones,{});
    source.mediciones['2.1'].vibracion=2;assert.equal(core.hydrate(daily,get).mediciones['0.0'].vibracion,2);
});
test('daily edits map only to linked source keys, never unavailable components or other OT',()=>{
    const {daily,get}=setup();const before=core.hydrate(daily,get),after=structuredClone(before);
    after.mediciones['0.0'].vibracion=3;after.mediciones['0.1']={vibracion:9};
    const updates=core.changes(after,before,get);assert.equal(updates.length,1);assert.equal(updates[0].id,'source');
    assert.equal(updates[0].mediciones['2.1'].vibracion,3);assert.equal(updates[0].mediciones['2.2'],undefined);
    assert.equal(get('source').mediciones['2.1'].vibracion,1);
});
test('unrelated daily edits do not overwrite newer source readings; clearing state propagates',()=>{
    const {daily,source,get}=setup();const before=core.hydrate(daily,get),after=structuredClone(before);
    source.mediciones['2.1']={vibracion:99};after.observaciones={'0.0':'Revisar'};
    let updates=core.changes(after,before,get);assert.equal(updates[0].mediciones['2.1'].vibracion,99);
    delete after.componentesEstado['0.0'];updates=core.changes(after,before,get);assert.equal(updates[0].componentesEstado['2.1'],undefined);
});
test('missing or closed source keeps saved snapshot and never resurrects the route',()=>{
    const {daily,get}=setup();const saved=core.hydrate(daily,get);
    assert.equal(core.hydrate(saved,()=>null).mediciones['0.0'].vibracion,1);assert.deepEqual(core.changes(saved,daily,()=>null),[]);
});
test('read baseline stays local and protects against source updates while editing',()=>{
    const {daily,source,get}=setup();const editing=core.hydrate(daily,get);
    source.mediciones['2.1']={vibracion:88};editing.observaciones={'0.0':'Nueva nota'};
    const updates=core.changes(editing,editing.__dailyBaseline,get);
    assert.equal(updates[0].mediciones['2.1'].vibracion,88);
    assert.equal(updates[0].observaciones['2.1'],'Nueva nota');
    assert.equal(JSON.stringify(editing).includes('__dailyBaseline'),false);
});
test('application normalization preserves import availability, provenance and exact execution links',()=>{
    const vm=require('node:vm'),fs=require('node:fs'),src=fs.readFileSync('app.js','utf8');
    const context=vm.createContext({window:{},crypto:{randomUUID:()=> 'generated'}});
    vm.runInContext(src.slice(src.indexOf('function _reqEquiposDesdeFuente'),src.indexOf('function obtenerRutaVibracion')),context);
    const eq={id:'eq',ot:'OT-22',enlace:{ejecucionId:'source',rutaIdx:4,componentKeys:['1.0']},rutaSugerida:4,entregaFuente:'entrega.pdf',componentes:[{nombre:'Motor',ubicacion_tecnica:'X--M01',disponible:false,observacionOperaciones:'En montaje'}]};
    const ej={componentesEstado:{__vibDiaria:{fecha:'2026-10-06'},__requerimientoEquipos:[eq]}};
    context.normalizarEjecucionRequerimientos(ej);
    assert.equal(ej.requerimientoEquipos[0].ot,'OT-22');assert.equal(ej.requerimientoEquipos[0].enlace.ejecucionId,'source');
    assert.equal(ej.requerimientoEquipos[0].componentes[0].disponible,false);assert.equal(ej.requerimientoEquipos[0].componentes[0].observacionOperaciones,'En montaje');
    assert.equal(ej.componentesEstado.__vibDiaria.fecha,'2026-10-06');assert.equal(ej.componentesEstado.__requerimientoEquipos[0].entregaFuente,'entrega.pdf');
});

test('daily data survives actual application upload/download helpers and retries a failed upload',async()=>{
    const vm=require('node:vm'),fs=require('node:fs'),createStore=require('./route-executions-store.js');
    const src=fs.readFileSync('app.js','utf8');
    const block=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
    const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
    const remote=new Map();let fail=false;
    const client={from(table){assert.equal(table,'rutas_ejecuciones');let payload,id;return {
        upsert(rows){payload=rows[0];id=payload.id;return this;},update(value){payload=value;return this;},
        eq(key,value){if(key==='id')id=value;return this;},select(){return this;},order(){return this;},
        async single(){if(fail)return {error:new Error('network unavailable')};remote.set(id,JSON.parse(JSON.stringify({...remote.get(id),...payload,id})));return {data:{id},error:null};},
        async range(){return {data:[...remote.values()].filter(r=>r.estado==='activa'),error:null};}
    };}};
    function browser(){
        const store=createStore(memory(),memory(),()=> 'new-id');
        const ctx=vm.createContext({window:{RouteExecutionStore:store,VibDailyCore:core,supabaseClient:client},navigator:{onLine:true},console,crypto:{randomUUID:()=> 'eq'},
            esRutaRequerimientos:idx=>Number(idx)===-2,obtenerRutaVibracion:()=>({nombre:'Plan diario',unidad:'DIARIA'}),migrarEjecucionesOrdenComponentes:()=>{},migrarEjecucionPuertoEquipoDuplicado:()=>{}});
        vm.runInContext(block('function getRutasEjecuciones()','// ── Sync con Supabase:'),ctx);
        vm.runInContext(block('function _reqEquiposDesdeFuente','function obtenerRutaVibracion'),ctx);
        vm.runInContext(block('async function _pushEjecucionASupabase','async function refrescarHistorialDesdeSupabase'),ctx);
        return {ctx,store};
    }
    const first=browser();
    const daily={id:'daily',rutaIdx:-2,_new:true,ot:'',estado:'activa',fechaInicio:'2026-10-06',liderId:'tech-1',ayudanteId:'tech-2',
        componentesEstado:{__vibDiaria:{fecha:'2026-10-06',archivo:'entrega.pdf'},'0.0':'listo'},mediciones:{'0.0':{vibracion:'1.23',temperaturas:[{punto:3,valor:44}]}},observaciones:{'0.0':'Verificar'},
        requerimientoEquipos:[{id:'eq',nombre:'Bomba',horaInicio:'23:30',horaFin:'01:15',ot:'12345',entregaFuente:'entrega.pdf',rutaSugerida:5,enlace:{ejecucionId:'route',rutaIdx:5,componentKeys:['2.1','2.2']},componentes:[comp('M'),{...comp('B'),disponible:false,observacionOperaciones:'En montaje'}]}]};
    first.ctx.setEjecucionActiva(-2,daily,{skipPush:true});
    fail=true;await assert.rejects(()=>first.ctx._pushEjecucionASupabase(-2,daily),/network unavailable/);
    assert.equal(first.store.get('daily')._dirty,true);assert.equal(remote.size,0);
    fail=false;await first.ctx._pushEjecucionASupabase(-2,daily);
    assert.equal(first.store.get('daily')._dirty,false);
    const payload=remote.get('daily');assert.equal(payload.componentes_estado.__requerimientoEquipos[0].enlace.ejecucionId,'route');
    assert.equal(payload.componentes_estado.__dailyBaseline,undefined);
    const second=browser();await second.ctx.refrescarRutasEjecucionesDesdeSupabase();
    const loaded=second.ctx.getEjecucionActiva(-2,'daily');
    assert.equal(loaded.mediciones['0.0'].vibracion,'1.23');assert.equal(loaded.mediciones['0.0'].temperaturas[0].punto,3);
    assert.equal(loaded.observaciones['0.0'],'Verificar');assert.equal(loaded.fechaInicio,'2026-10-06');
    assert.equal(loaded.requerimientoEquipos[0].horaInicio,'23:30');assert.equal(loaded.requerimientoEquipos[0].horaFin,'01:15');
    assert.equal(loaded.requerimientoEquipos[0].ot,'12345');assert.equal(loaded.requerimientoEquipos[0].componentes[1].disponible,false);
    assert.equal(loaded.requerimientoEquipos[0].componentes[1].observacionOperaciones,'En montaje');
    assert.equal(loaded.componentesEstado.__vibDiaria.archivo,'entrega.pdf');assert.equal(loaded.liderId,'tech-1');
});
