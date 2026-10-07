const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/mantenimiento.js', 'utf8');
async function render(session, load) {
    const handlers = {};
    const host = {innerHTML: '', querySelector: id => ({addEventListener: (event, action) => {handlers[id] = action;}}), querySelectorAll: () => []};
    const context = {window: {MaintenanceCloud: {session, load}}, location: {hostname:'localhost'}, document: {body:{dataset:{view:'mantenimiento'}}}, URL:{revokeObjectURL(){}}, setTimeout};
    vm.runInNewContext(source, context);
    context.window.PlanifyMantenimiento.render(host, []);
    await new Promise(resolve => setImmediate(resolve));
    return {host, handlers, context};
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
