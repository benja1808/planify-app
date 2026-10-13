const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('app.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function periodoPagoHorasExtra('), source.indexOf('// ── HORAS EXTRA: guardar registro')), context);

test('days 1 and 9 pay at month end; day 10 and month end pay next month', () => {
    for (const day of ['01', '09']) {
        const result = context.periodoPagoHorasExtra(`2026-10-${day}`);
        assert.equal(result.periodo, 'fin-mes');
        assert.equal(result.fechaPago, '2026-10-31');
    }
    for (const day of ['10', '30', '31']) {
        const result = context.periodoPagoHorasExtra(`2026-10-${day}`);
        assert.equal(result.periodo, 'mes-siguiente');
        assert.equal(result.fechaPago, '2026-11-07');
    }
});

test('payment dates handle February, leap years, 30 days and year rollover', () => {
    for (const [date, expected] of [
        ['2026-02-09', '2026-02-28'], ['2028-02-09', '2028-02-29'],
        ['2028-02-29', '2028-03-07'], ['2026-04-01', '2026-04-30'],
        ['2026-12-31', '2027-01-07']
    ]) assert.equal(context.periodoPagoHorasExtra(date).fechaPago, expected);
    for (const date of ['', null, '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00']) {
        assert.equal(context.periodoPagoHorasExtra(date), null);
    }
});

test('summary splits approved and pending hours, filters month and worker, excludes rejected', () => {
    const rows = [
        { trabajador_id: 'a', fecha: '2026-10-09', horas: '2.5', estado: 'aprobado' },
        { trabajador_id: 'a', fecha: '2026-10-10', horas: 3, estado: 'aprobado' },
        { trabajador_id: 'a', fecha: '2026-10-31', horas: 1.5, estado: 'pendiente' },
        { trabajador_id: 'a', fecha: '2026-10-01', horas: 20, estado: 'rechazado' },
        { trabajador_id: 'b', fecha: '2026-10-09', horas: 4, estado: 'aprobado' },
        { trabajador_id: 'a', fecha: '2026-09-09', horas: 10, estado: 'aprobado' }
    ];
    const result = context.resumirPagosHorasExtra(rows, '2026-10', 'a');
    assert.equal(result['fin-mes'].aprobadas, 2.5);
    assert.equal(result['fin-mes'].pendientes, 0);
    assert.equal(result['mes-siguiente'].aprobadas, 3);
    assert.equal(result['mes-siguiente'].pendientes, 1.5);
    assert.equal(context.resumirPagosHorasExtra(rows, '2026-10')['fin-mes'].aprobadas, 6.5);
    rows[2].estado = 'aprobado';
    assert.equal(context.resumirPagosHorasExtra(rows, '2026-10', 'a')['mes-siguiente'].aprobadas, 4.5);
});
