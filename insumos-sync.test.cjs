const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const src = require('node:fs').readFileSync('app.js', 'utf8');
function setup({ online = true, failure = false, queueFailure = false } = {}) {
    const saved = [], queued = [];
    const context = vm.createContext({
        estado: { trabajadores: [{ id: 'worker' }, { id: 'other' }] },
        usuarioPuedeAprobarInsumos: () => false, usuarioSolicitanteActualId: () => 'worker',
        navigator: { onLine: online }, crypto: { randomUUID: () => 'request-id' },
        normalizarSolicitudInsumo: item => ({ ...item }), console,
        tablasDb: { solicitudesInsumos: 'solicitudes_insumos' },
        insumosFeatureState: { tablasRemotas: { solicitudes: true } },
        supabaseClient: { from: () => ({ insert: async () => {
            if (failure === 'throw') throw new Error('network');
            return { error: failure ? new Error('server') : null };
        } }) },
        window: { localDB: {}, syncQueue: { add: async (...args) => {
            if (queueFailure) throw new Error('storage');
            queued.push(args);
        } } },
        persistirSolicitudInsumoLocal: async item => saved.push(item),
        actualizarBadgeInsumos: () => {}
    });
    vm.runInContext(src.slice(src.indexOf('async function guardarSolicitudInsumo('), src.indexOf('async function aprobarSolicitudInsumo(')), context);
    return { context, saved, queued };
}
test('offline, HTTP errors and network exceptions persist a retry with the same ID', async () => {
    for (const options of [{ online: false }, { failure: true }, { failure: 'throw' }]) {
        const { context, saved, queued } = setup(options);
        const result = await context.guardarSolicitudInsumo('worker', 'supply', 2);
        assert.equal(result.pendienteSincronizacion, true);
        assert.equal(queued.length, 1);
        assert.equal(queued[0][2].id, saved[0].id);
    }
});
test('successful send is confirmed and is not queued', async () => {
    const { context, queued } = setup();
    assert.equal((await context.guardarSolicitudInsumo('worker', 'supply', 2)).pendienteSincronizacion, false);
    assert.equal(queued.length, 0);
});
test('failed durable storage is never reported as success', async () => {
    const { context } = setup({ online: false, queueFailure: true });
    await assert.rejects(context.guardarSolicitudInsumo('worker', 'supply', 2), /storage/);
});
test('pagination reads all records even when server caps pages below requested size', async () => {
    const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const context = vm.createContext({ tablasDb: { solicitudesInsumos: 'solicitudes_insumos' },
        supabaseClient: { from: () => ({ select() { return this; }, order() { return this; },
            range: async start => ({ data: rows.slice(start, start + 100) }) }) } });
    vm.runInContext(src.slice(src.indexOf('async function fetchAllSolicitudesInsumos('), src.indexOf('async function fetchAllEquipos(')), context);
    assert.equal((await context.fetchAllSolicitudesInsumos()).length, 1203);
});
test('refresh preserves unsent local requests and accepts server status changes', () => {
    const context = vm.createContext({ normalizarSolicitudInsumo: item => item });
    vm.runInContext(src.slice(src.indexOf('function combinarSolicitudesInsumos('), src.indexOf('async function fetchAllEquipos(')), context);
    const result = context.combinarSolicitudesInsumos(
        [{ id: 'remote', estado: 'aprobada' }],
        [{ id: 'local' }, { id: 'remote', estado: 'pendiente' }],
        new Set(['local'])
    );
    assert.equal(result.length, 2);
    assert.equal(result.find(item => item.id === 'remote').estado, 'aprobada');
});
const queueSource = require('node:fs').readFileSync('syncQueue.js', 'utf8');
test('retry of an already received request does not reset its approval', async () => {
    let options;
    const context = vm.createContext({ console, window: { supabaseClient: { from: () => ({
        insert: async () => ({ error: { code: '23505' } }),
        upsert: async (payload, opts) => { options = opts; return { error: null }; }
    }) } } });
    vm.runInContext(queueSource.slice(queueSource.indexOf('  async function _ejecutarOperacion('), queueSource.indexOf('  async function reintentarErrores(')), context);
    assert.equal(await context._ejecutarOperacion({ tabla: 'solicitudes_insumos', operacion: 'INSERT', payload: { id: 'request', estado: 'pendiente' } }), true);
    assert.equal(options.ignoreDuplicates, true);
    assert.equal(options.onConflict, 'id');
});
test('legacy local requests can be resent without overwriting existing approvals or sending local metadata', async () => {
    let sent, options, saved;
    const context = vm.createContext({ navigator: { onLine: true },
        obtenerSolicitudInsumoPorId: () => ({ id: 'old', trabajador_id: 'worker', estado: 'pendiente', pendienteSincronizacion: true }),
        usuarioPuedeAprobarInsumos: () => false,
        usuarioSolicitanteActualId: () => 'worker', normalizarSolicitudInsumo: item => item,
        tablasDb: { solicitudesInsumos: 'solicitudes_insumos' },
        persistirSolicitudInsumoLocal: async item => { saved = item; },
        supabaseClient: { from: () => ({
            upsert: async (rows, opts) => { sent = rows[0]; options = opts; return {}; },
            select() { return this; }, eq() { return this; },
            single: async () => ({ data: { id: 'old', trabajador_id: 'worker', estado: 'aprobada' } })
        }) }
    });
    vm.runInContext(src.slice(src.indexOf('async function reenviarSolicitudInsumo('), src.indexOf('async function aprobarSolicitudInsumo(')), context);
    await context.reenviarSolicitudInsumo('old');
    assert.equal(sent.id, 'old');
    assert.equal('pendienteSincronizacion' in sent, false);
    assert.equal(options.ignoreDuplicates, true);
    assert.equal(saved.estado, 'aprobada');
    assert.equal(saved.pendienteSincronizacion, false);
    context.usuarioSolicitanteActualId = () => 'someone-else';
    await assert.rejects(context.reenviarSolicitudInsumo('old'), /Solo el solicitante/);
});

test('approvers can create pending requests for another worker; ordinary workers cannot', async () => {
    const { context, saved } = setup();
    await assert.rejects(context.guardarSolicitudInsumo('other', 'supply', 2), /permiso/);
    assert.equal(saved.length, 0);
    context.usuarioPuedeAprobarInsumos = () => true;
    await context.guardarSolicitudInsumo('other', 'supply', 2);
    assert.equal(saved[0].trabajador_id, 'other');
    assert.equal(saved[0].estado, 'pendiente');
    for (const id of ['', null, 'missing']) {
        await assert.rejects(context.guardarSolicitudInsumo(id, 'supply', 2), /persona válida/);
    }
});
test('new supplies are persisted locally only after the server confirms them', async () => {
    let fail = true, localWrites = 0;
    const ctx = vm.createContext({
        usuarioPuedeAprobarInsumos: () => true, exigirConexionInsumos() {},
        normalizarRegistroInsumo: item => item,
        tablasDb: { insumos: 'insumos' },
        persistirInsumoLocal: async () => { localWrites++; },
        supabaseClient: { from: () => ({ insert() { return this; }, select() { return this; },
            single: async () => fail ? { error: new Error('server failure') } : { data: { id: 'supply', nombre: 'Nuevo' } } }) }
    });
    vm.runInContext(src.slice(src.indexOf('async function crearInsumoConfirmado('), src.indexOf('async function guardarSolicitudInsumo(')), ctx);
    await assert.rejects(ctx.crearInsumoConfirmado({ id: 'supply', nombre: 'Nuevo' }));
    assert.equal(localWrites, 0);
    fail = false;
    await ctx.crearInsumoConfirmado({ id: 'supply', nombre: 'Nuevo' });
    assert.equal(localWrites, 1);
});
function confirmedOps({ fail = false, online = true } = {}) {
    const writes = [], local = [], filters = [];
    const ctx = vm.createContext({
        navigator: { onLine: online }, usuarioPuedeAprobarInsumos: () => true, esRolGestion: () => true,
        tablasDb: { insumos: 'insumos', solicitudesInsumos: 'solicitudes_insumos' },
        estado: { solicitudesInsumos: [{ id: 'request' }], movimientosInventario: [] },
        obtenerInsumoPorId: () => ({ id: 'supply', stock_actual: 8 }), enteroSeguro: Number,
        nombreAprobadorActual: () => 'Approver', actualizarBadgeInsumos() {}, refrescarDatosInsumos: async () => {},
        persistirInsumoLocal: async row => local.push(row), persistirSolicitudInsumoLocal: async row => local.push(row),
        registrarMovimientoInventarioLocal: async row => local.push(row),
        window: { localDB: { solicitudes_insumos: { delete: async id => local.push(id) } } },
        supabaseClient: {
            from: () => ({ update(patch) { writes.push(patch); return this; }, eq(k,v) { filters.push([k,v]); return this; },
                select() { return this; }, single: async () => fail ? { error: new Error('server failure') } : { data: { id: 'supply', stock_actual: 20 } } }),
            rpc: async (name, args) => {
                writes.push(args);
                if (fail) return { error: new Error('server failure') };
                if (name === 'eliminar_solicitudes_insumo_seguras') return { data: { eliminadas: 1, insumos: [{ id: 'supply', stock_actual: 8 }] } };
                return { data: { insumo: { id: 'supply', stock_actual: args.p_despues }, movimiento: null } };
            }
        }
    });
    vm.runInContext(src.slice(src.indexOf('function exigirConexionInsumos('), src.indexOf('async function registrarMovimientoManual(')), ctx);
    vm.runInContext(src.slice(src.indexOf('async function resolverSolicitudInsumo('), src.indexOf('async function actualizarPermisoAprobadorInsumos(')), ctx);
    return { ctx, local, writes, filters };
}
test('failed/offline approval, rejection, editing, stock adjustment and deletion leave local state unchanged', async () => {
    for (const options of [{ fail: true }, { online: false }]) {
        const { ctx, local } = confirmedOps(options);
        for (const run of [() => ctx.aprobarSolicitudInsumo('request'), () => ctx.rechazarSolicitudInsumo('request','motivo'),
            () => ctx.actualizarConfiguracionInsumo('supply', { nombre: 'New' }),
            () => ctx.ajustarStockInsumo('supply', 5), () => ctx.eliminarSolicitudInsumoSegura('request')]) {
            await assert.rejects(run());
        }
        assert.equal(local.length, 0);
        assert.equal(ctx.estado.solicitudesInsumos.length, 1);
    }
});
test('renaming sends only edited metadata and uses returned server stock', async () => {
    const { ctx, local, writes } = confirmedOps();
    await ctx.actualizarConfiguracionInsumo('supply', { nombre: 'New', stock_actual: 8 });
    assert.equal(JSON.stringify(writes[0]), '{"nombre":"New"}');
    assert.equal(local[0].stock_actual, 20);
});
test('changing name and stock uses one atomic RPC', async () => {
    const { ctx, writes } = confirmedOps();
    await ctx.ajustarStockInsumo('supply', 5, 'conteo', 'ajuste', 'Nombre nuevo');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].p_despues, 5);
    assert.equal(writes[0].p_nombre, 'Nombre nuevo');
});
test('approval requires pending state on the server and deletion is confirmed before local removal', async () => {
    const { ctx, filters, local } = confirmedOps();
    await ctx.aprobarSolicitudInsumo('request');
    assert.ok(filters.some(([key,value]) => key === 'estado' && value === 'pendiente'));
    await ctx.eliminarSolicitudInsumoSegura('request');
    assert.equal(ctx.estado.solicitudesInsumos.length, 0);
    assert.ok(local.includes('request'));
});
test('remote deletions disappear and only requests backed by the durable queue remain recoverable', () => {
    const ctx = vm.createContext({ normalizarSolicitudInsumo: item => item });
    vm.runInContext(src.slice(src.indexOf('function combinarSolicitudesInsumos('), src.indexOf('async function fetchAllEquipos(')), ctx);
    const rows = ctx.combinarSolicitudesInsumos(
        [],
        [{ id: 'deleted', confirmadoRemoto: true }, { id: 'legacy' }, { id: 'unsent' }],
        new Set(['unsent'])
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'unsent');
});
test('approver permission changes update local state only after server confirmation', async () => {
    const worker = { id: 'worker', puede_aprobar_insumos: false };
    let fail = true;
    const ctx = vm.createContext({
        estado: { trabajadores: [worker], trabajadorLogueado: null },
        esRolGestion: () => true, exigirConexionInsumos() {},
        insumosFeatureState: { aprobadoresPersistentes: true },
        window: { localDB: { trabajadores: { upsert: async () => {} } } },
        supabaseClient: { from: () => ({ update() { return this; }, eq() { return this; }, select() { return this; },
            single: async () => fail ? { error: new Error('server failure') } : { data: { id: 'worker', puede_aprobar_insumos: true } } }) }
    });
    vm.runInContext(src.slice(src.indexOf('async function actualizarPermisoAprobadorInsumos('), src.indexOf('function obtenerValorFilaInventario(')), ctx);
    await assert.rejects(ctx.actualizarPermisoAprobadorInsumos('worker', true));
    assert.equal(ctx.estado.trabajadores[0].puede_aprobar_insumos, false);
    fail = false;
    await ctx.actualizarPermisoAprobadorInsumos('worker', true);
    assert.equal(ctx.estado.trabajadores[0].puede_aprobar_insumos, true);
});
