const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const src = require('node:fs').readFileSync('app.js', 'utf8');
function setup(management, approver) {
    const item = { id: 'item', stock_actual: 8 };
    const movements = [];
    const context = vm.createContext({
        navigator: { onLine: true },
        supabaseClient: { rpc: async (name, args) => ({ data: {
            insumo: { ...item, stock_actual: args.p_despues },
            movimiento: { creado_por: args.p_actor, stock_antes: args.p_antes, stock_despues: args.p_despues }
        } }) },
        esRolGestion: () => management,
        obtenerTrabajadorActual: () => ({ puede_aprobar_insumos: approver }),
        obtenerInsumoPorId: () => item,
        enteroSeguro: (value, fallback) => Number.isInteger(Number(value)) ? Number(value) : fallback,
        persistirInsumoLocal: async value => Object.assign(item, value),
        sincronizarInsumoRemoto: async () => true,
        normalizarMovimientoInventario: value => value,
        registrarMovimientoInventarioLocal: async value => movements.push(value),
        sincronizarMovimientoRemoto: async () => true,
        nombreAprobadorActual: () => 'Aprobador',
        crypto: { randomUUID: () => 'movement' }
    });
    vm.runInContext(src.slice(src.indexOf('function usuarioPuedeAprobarInsumos()'), src.indexOf('function usuarioSolicitanteActualId()')), context);
    vm.runInContext(src.slice(src.indexOf('function exigirConexionInsumos('), src.indexOf('async function eliminarInsumoCatalogo(')), context);
    return { context, item, movements };
}
test('approvers and management can set total stock to zero with an attributed movement', async () => {
    for (const roles of [[false, true], [true, false]]) {
        const { context, item, movements } = setup(...roles);
        await context.ajustarStockInsumo('item', 0, 'Conteo físico');
        assert.equal(item.stock_actual, 0);
        assert.equal(movements.length, 1);
        assert.equal(movements[0].creado_por, 'Aprobador');
        assert.equal(movements[0].stock_antes, 8);
        assert.equal(movements[0].stock_despues, 0);
    }
});
test('ordinary workers cannot change stock directly or through a manual movement', async () => {
    const { context, item, movements } = setup(false, false);
    await assert.rejects(context.ajustarStockInsumo('item', 0), /permiso/);
    await assert.rejects(context.registrarMovimientoManual('item', 'entrada', 2), /permiso/);
    assert.equal(item.stock_actual, 8);
    assert.equal(movements.length, 0);
});
