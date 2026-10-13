const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
function context(equipos) {
    const ctx = vm.createContext({ window: {}, estado: { equipos } });
    vm.runInContext(source.slice(source.indexOf('function _equipoEsCanonico('), source.indexOf('function renderEquiposView(')), ctx);
    const start = source.indexOf('function gruposEquiposParaRequerimiento()');
    vm.runInContext(source.slice(start, source.indexOf('window.rutasEditarOtEjecucion', start)), ctx);
    return ctx;
}
test('VTF retains fan beside canonical motor and keeps every measurement ID accessible', () => {
    const rows = [
        { id: 'motor', kks: 'GUA3-HLB10-AN101', componente: 'Motor' },
        { id: 'fan', kks: '2893-35-HLB10-AN101-KN01', componente: 'Ventilador' },
        { id: 'duplicate', kks: '2893-35-HLB10-AN101--M01', componente: 'MOTOR ELECTRICO VTF' },
        { id: 'other-unit', kks: '2893-45-HLB10-AN101--M01', componente: 'Motor' }
    ];
    assert.deepEqual(Array.from(context(rows).filtrarEquiposDuplicados(rows), e => e.id), ['motor', 'fan', 'duplicate', 'other-unit']);
});

test('requirement picker includes all component IDs despite different asset names and unit labels', () => {
    const rows = [
        { id: 'motor', activo: 'VENTILADOR TIRO FORZADO VTF U5', ubicacion: 'U5', kks: '2893-55-HLB10-AN101--M01', componente: 'Motor' },
        { id: 'fan', activo: 'Ventilador tiro forzado', ubicacion: 'Unidad 5', kks: '2893-55-HLB10-AN101-KN01', componente: 'Ventilador' },
        { id: 'bearing', kks: '2893-55-HLB10-AN101-MU01', componente: 'Descanso' },
        { id: 'other', activo: 'VENTILADOR TIRO FORZADO VTF U5', ubicacion: 'U5', kks: '2893-55-HLB10-AN102--M01', componente: 'Motor' },
        { id: 'u4', activo: 'Ventilador tiro forzado', ubicacion: 'U4', kks: '2893-45-HLB10-AN101-KN01', componente: 'Ventilador' }
    ];
    const groups = context(rows).gruposEquiposParaRequerimiento();
    const vtf = groups.find(g => g.componentes.some(c => c.id === 'motor'));
    assert.deepEqual(Array.from(vtf.componentes, c => c.equipo_id).sort(), ['bearing', 'fan', 'motor']);
    assert.equal(groups.length, 3);
    assert.ok(vtf.busqueda.includes('Unidad 5'));
});
test('VTF aliases group within their unit without joining other assets', () => {
    const ctx = context([]);
    const key = ctx._claveActivoFicha;
    const base = { activo: 'Ventilador Tiro Forzado', ubicacion: 'Unidad 3' };
    assert.equal(key(base), key({ activo: 'VENTILADOR TIRO FORZADO VTF U3', ubicacion: 'U3' }));
    assert.notEqual(key(base), key({ activo: base.activo, ubicacion: 'Unidad 4' }));
    assert.notEqual(key(base), key({ activo: 'Ventilador Tiro Forzado VF-01', ubicacion: base.ubicacion }));
    assert.notEqual(key(base), key({ activo: base.activo }));
});

test('technical identity joins names across equipment families and preserves unit, sector and machine', () => {
    const key = context([])._claveActivoFicha;
    for (const code of ['LCB01-AP101', 'ECA09-AF001', 'HFC02-AJ101', 'HRA02-AM101', 'HLB20-AN101']) {
        const parent = { kks: 'GUA3-5' + code, activo: 'Nombre catálogo', ubicacion: 'Unidad 3' };
        assert.equal(key(parent), key({ kks: '2893-35-' + code + '--M01', activo: 'MOTOR', ubicacion: 'U3' }));
        assert.equal(key(parent), key({ kks: '2893-35-' + code + '-KP02', activo: 'BOMBA AUXILIAR' }));
        for (const prefix of ['2893-45-', '2893-33-', '2893-01-']) assert.notEqual(key(parent), key({kks: prefix + code}));
        assert.notEqual(key(parent), key({ kks: 'GUA3-5' + code.replace('101', '102').replace('001', '002') }));
    }
});
test('two motors, auxiliary pumps and unnamed bearings remain accessible', () => {
    const rows = ['--M01', '--M02', '-KP01', '-KP02', '-MU01', '-MU02'].map((suffix, id) => ({id, kks: '2893-35-LAC01-AP101' + suffix}));
    const ctx = context(rows);
    assert.equal(ctx.filtrarEquiposDuplicados(rows).length, 6);
    assert.equal(new Set(rows.map(ctx._claveActivoFicha)).size, 1);
});
