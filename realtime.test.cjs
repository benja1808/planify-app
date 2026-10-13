const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('app.js', 'utf8');

function setup() {
    const timers = new Map(), handlers = {}, requests = [];
    let nextTimer = 0, subscriptions = 0, renders = 0;
    const channel = {
        on(type, filter, callback) { handlers[filter.table] = callback; return this; },
        subscribe() { subscriptions++; return this; }
    };
    const context = {
        console: { warn() {} }, window: {},
        estado: { tareas: [{ id: 'saved' }], trabajadores: [{ id: 'worker' }] },
        insumosFeatureState: { tablasRemotas: {} }, tablasDb: {},
        _aplicarTransicionesLocalesTareas: data => data,
        evaluarNotificacionesPlanify() {},
        solicitarRenderRealtimeNoIntrusivo() { renders++; },
        setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
        supabaseClient: {
            channel() { return channel; },
            from(table) { return { select() { return new Promise(resolve => requests.push({ table, resolve })); } }; }
        }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('let realtimeChannel = null;'), source.indexOf('async function updateTrabajadorDisponibilidad')), context);
    context.configurarRealtime();
    return { context, requests, timers, handlers, subscriptions: () => subscriptions, renders: () => renders,
        flush() { const [id, fn] = timers.entries().next().value; timers.delete(id); return fn(); } };
}

test('realtime subscribes once and coalesces bursts', async () => {
    const s = setup();
    s.context.configurarRealtime();
    assert.equal(s.subscriptions(), 1);
    for (let i = 0; i < 100; i++) s.handlers.tareas();
    assert.equal(s.timers.size, 1);
    const run = s.flush();
    assert.equal(s.requests.length, 1);
    s.requests[0].resolve({ data: [], error: null });
    await run;
    assert.equal(s.context.estado.tareas.length, 0);
});

test('failed query preserves existing data while successful tables update', async () => {
    const s = setup();
    s.handlers.tareas(); s.handlers.trabajadores();
    const run = s.flush();
    s.requests[0].resolve({ data: null, error: new Error('network') });
    s.requests[1].resolve({ data: [{ id: 'new-worker' }] });
    await run;
    assert.equal(s.context.estado.tareas[0].id, 'saved');
    assert.equal(s.context.estado.trabajadores[0].id, 'new-worker');
});

test('events during a slow query wait and fetch again without overlap', async () => {
    const s = setup();
    s.handlers.tareas();
    const first = s.flush();
    for (let i = 0; i < 50; i++) s.handlers.tareas();
    assert.equal(s.requests.length, 1);
    assert.equal(s.timers.size, 0);
    s.requests[0].resolve({ data: [{ id: 'first' }] });
    await first;
    assert.equal(s.timers.size, 1);
    const second = s.flush();
    s.requests[1].resolve({ data: [{ id: 'latest' }] });
    await second;
    assert.equal(s.context.estado.tareas[0].id, 'latest');
    assert.equal(s.timers.size, 0);
});

test('remote changes and returning focus never rebuild the open form', () => {
    let pills = 0, renders = 0;
    const listeners = {};
    const c = {
        pendingRealtimeRender: false, realtimeResumeTimer: null, operacionesMasivasEnCurso: 0,
        document: { hidden: false, addEventListener(name, fn) { listeners[name] = fn; } },
        window: { addEventListener(name, fn) { listeners[name] = fn; } },
        clearTimeout() {}, _mostrarPillCambios() { pills++; },
        renderizarVistaActualPreservandoViewport() { renders++; }
    };
    vm.createContext(c);
    vm.runInContext(source.slice(source.indexOf('function intentarAplicarRealtimePendiente()'), source.indexOf('async function renderInsumosView()')), c);
    for (let i = 0; i < 100; i++) c.solicitarRenderRealtimeNoIntrusivo();
    listeners.focus(); listeners.visibilitychange();
    assert.equal(renders, 0);
    assert.equal(c.pendingRealtimeRender, true);
    assert.ok(pills > 0);
});

test('equipment paging rejects a failed later page instead of returning partial data', async () => {
    let page = 0;
    const c = { supabaseClient: { from() { return { select() { return this; }, async range() {
        return page++ === 0 ? { data: Array(1000).fill({ id: 'equipment' }) } : { data: null, error: new Error('network') };
    } }; } } };
    vm.createContext(c);
    vm.runInContext(source.slice(source.indexOf('async function fetchAllEquipos()'), source.indexOf('async function resolverTabla(')), c);
    await assert.rejects(c.fetchAllEquipos(), /network/);
});
