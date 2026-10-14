const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('node:fs').readFileSync('app.js', 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('maintenance filtering preserves selected files and typed interventions', async () => {
    const src = require('node:fs').readFileSync('modules/mantenimiento/mantenimiento.js','utf8');
    const start = src.indexOf("on('maint-filter', 'change'");
    const end = src.indexOf("on('maint-files'",start);
    for(const field of [{type:'file',files:[{}]}, {tagName:'TEXTAREA',value:'Trabajo',defaultValue:''}, {tagName:'SELECT',options:[{}],selectedIndex:0}]) {
        let handler, paints=0, notices=0;
        const ctx=vm.createContext({host:{querySelector:()=>({querySelectorAll:()=>[field]})},filter:'',on:(id,event,fn)=>handler=fn,paint:()=>paints++,notice:()=>notices++});
        vm.runInContext(src.slice(start,end),ctx);
        const event={target:{value:'END'}};
        await handler(event);
        assert.equal(paints,field.tagName==='SELECT'?1:0);
        assert.equal(notices,field.tagName==='SELECT'?0:1);
    }
});

test('refresh does not fetch or rebuild while a form is being edited', async () => {
    let notices = 0;
    const ctx = vm.createContext({ window: {}, hayUIBloqueandoRealtime: () => true,
        solicitarRenderRealtimeNoIntrusivo: () => notices++, mostrarToastNotificacion() {} });
    vm.runInContext(block('window.forzarRefrescoPlanify =', '// ── Pull-to-refresh'), ctx);
    await ctx.window.forzarRefrescoPlanify();
    assert.equal(notices, 1);
    assert.equal(ctx.window._planifyRefreshing, undefined);
});

test('refresh completing after navigation or new editing never rebuilds that screen', async () => {
    for (const scenario of ['navigate', 'edit']) {
        let resolve, renders = 0, notices = 0, editing = false;
        const request = new Promise(r => resolve = r);
        const ctx = vm.createContext({ window: { supabaseClient: { from: () => ({ select: () => request }) } },
            navigator: { onLine: true }, vistaActual: 'rutas', estado: {},
            fetchAllEquipos: () => request.then(() => []),
            hayUIBloqueandoRealtime: () => editing, solicitarRenderRealtimeNoIntrusivo: () => notices++,
            mostrarToastNotificacion() {}, evaluarNotificacionesPlanify() {},
            renderizarVistaActual: () => renders++, console });
        vm.runInContext(block('window.forzarRefrescoPlanify =', '// ── Pull-to-refresh'), ctx);
        const run = ctx.window.forzarRefrescoPlanify();
        if (scenario === 'navigate') ctx.vistaActual = 'insumos';
        else editing = true;
        resolve({ data: null });
        await run;
        assert.equal(renders, 0);
        assert.equal(notices, 1);
        assert.equal(ctx.window._planifyRefreshing, false);
    }
});

test('late inventory and overtime loads cannot overwrite another view or a newer load', async () => {
    for (const name of ['renderInsumosView', 'renderMisHorasView', 'renderHorasExtraAdminView']) {
        const start = source.lastIndexOf(`async function ${name}()`);
        const guard = 'if (mainContent.firstElementChild !== cargaActual) return;';
        const end = source.indexOf(guard, start) + guard.length;
        const prefix = source.slice(start, end) + '\n completions++; }';
        let resolve;
        const pending = new Promise(r => resolve = r);
        const host = { firstElementChild: null, set innerHTML(value) { this.firstElementChild = { value }; } };
        const ctx = vm.createContext({ mainContent: host, estado: { trabajadorLogueado: { id: 'worker' } },
            refrescarDatosInsumos: () => pending, cargarHorasExtraTrabajador: () => pending,
            cargarTodasHorasExtra: () => pending, completions: 0 });
        vm.runInContext(prefix, ctx);
        const first = ctx[name]();
        const second = ctx[name]();
        resolve([]);
        await Promise.all([first, second]);
        assert.equal(ctx.completions, 1, name);
        const next = ctx[name]();
        host.innerHTML = 'Otra pantalla';
        await next;
        assert.equal(ctx.completions, 1, name);
    }
});

test('empty inputs, selects and open dialogs block refresh even without typed text', () => {
    const ctx = vm.createContext({ document: { hidden: false, activeElement: {}, querySelectorAll: () => [], getElementById: () => null },
        hayDatosSinGuardar: () => false, esElementoVisibleUI: () => true });
    vm.runInContext(block('function hayUIBloqueandoRealtime()', '// Pill "Hay cambios nuevos"'), ctx);
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
        ctx.document.activeElement = { tagName, value: '' };
        assert.equal(ctx.hayUIBloqueandoRealtime(), true);
    }
    ctx.document.activeElement = { tagName: 'BUTTON' };
    ctx.document.querySelectorAll = () => [{}];
    assert.equal(ctx.hayUIBloqueandoRealtime(), true);
});

test('background route refresh defers rendering instead of re-entering the refresh loop', async () => {
    let resolve, notices = 0, calls = 0, data = [];
    const ctx = vm.createContext({ estado: { usuarioActual: 'admin' }, window: { supabaseClient: {} },
        _rutasRefrescoEnVuelo: false, getTodasEjecucionesRutas: () => data,
        refrescarRutasEjecucionesDesdeSupabase: () => { calls++; return new Promise(r => resolve = r); },
        vistaActual: 'rutas', vistaRutasEstado: { seccionActiva: '' }, renderVibracionesHub() {},
        solicitarRenderRealtimeNoIntrusivo: () => notices++ });
    const start = source.indexOf('function renderRutasView()');
    const end = source.indexOf("    if (vistaRutasEstado.seccionActiva === 'diaria'", start);
    vm.runInContext(source.slice(start, end) + '\n}', ctx);
    ctx.renderRutasView();
    data = [{ id: 'new' }]; resolve(data);
    await new Promise(r => setImmediate(r));
    assert.equal(calls, 1);
    assert.equal(notices, 1);
});
