const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keys, normalize, number, metrics } = require('./excitatriz-ocr-core.js');
const { extract, validateImage, isLocal, readImageBody } = require('./excitatriz-ocr-server.cjs');
const { Readable } = require('node:stream');
const image = 'data:image/png;base64,iVBORw0KGgo=';
test('Gemini sends inline image and schema; normalizes response without fallback', async () => {
    let calls = 0;
    const result = await extract({ unit: 4, image }, { provider: 'gemini', apiKey: 'test', fetchImpl: async (url, options) => {
        calls++;
        assert.match(url, /generativelanguage.googleapis.com/);
        assert.match(url, /gemini-3\.1-flash-lite:generateContent$/);
        assert.equal(options.headers['x-goog-api-key'], 'test');
        const body = JSON.parse(options.body);
        assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/png');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        assert.ok(body.generationConfig.responseJsonSchema);
        return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ unit: 4, cells: [{ key: '1.1:temp', value: 53.7 }] }) }] } }] }) };
    } });
    assert.equal(result.provider, 'gemini');
    assert.equal(result.cells[0].value, 53.7);
    assert.equal(calls, 1);
});
test('Gemini missing key, quota and incomplete responses do not trigger paid fallback', async () => {
    await assert.rejects(extract({ unit: 4, image }, { provider: 'gemini', apiKey: '' }), /GEMINI_API_KEY/);
    for (const result of [{ ok: false, status: 429 }, { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) }, { ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }]) {
        let calls = 0;
        await assert.rejects(extract({ unit: 4, image }, { provider: 'gemini', apiKey: 'test', fetchImpl: async () => { calls++; return result; } }));
        assert.equal(calls, 1);
    }
});
test('unavailable model and invalid credentials give specific safe errors', async () => {
    for (const [status, message] of [[404, /modelo de lectura no está disponible/], [401, /rechazó la clave/], [403, /denegó el acceso/], [400, /compatibilidad del modelo/]]) {
        await assert.rejects(extract({ unit: 4, image }, { provider: 'gemini', apiKey: 'secret-test', fetchImpl: async () => ({ ok: false, status }) }), message);
    }
});
test('upstream saturation stays 503 and exposes only safe diagnostic metadata', async () => {
    await assert.rejects(extract({ unit: 4, image }, {
        provider: 'gemini', apiKey: 'secret', model: 'gemini-3.7-flash',
        fetchImpl: async () => ({ ok: false, status: 503 })
    }), error => error.status === 503 && error.providerStatus === 503 && error.model === 'gemini-3.7-flash' && !error.message.includes('secret'));
});
test('U3 has four positions; U4/U5 three, with five global values', () => {
    assert.equal(keys(3).length, 117);
    assert.equal(keys(4).length, 89);
    assert.equal(keys(5).length, 89);
    assert.throws(() => keys(2));
});
test('decimal commas and zero preserved; ambiguous text never guessed', () => {
    assert.equal(number(' 0,6 '), 0.6);
    assert.equal(number(0), 0);
    for (const v of ['', null, true, '1,2,3', '5O', '12 A', Infinity]) assert.equal(number(v), null);
});
test('mapping by identifier, missing fields and duplicate positions', () => {
    const cells = normalize({ unit: 4, cells: [{ key: '14.3:corr', value: '2,9' }, { key: '1.1:temp', value: 50 }, { key: '1.1:temp', value: 60 }] }, 4);
    assert.equal(cells.find(c => c.key === '14.3:corr').value, 2.9);
    assert.equal(cells.find(c => c.key === '1.1:temp').value, null);
    assert.equal(cells.find(c => c.key === '1.1:corr').value, null);
    assert.equal(cells.length, 89);
    assert.throws(() => normalize({ unit: 3, cells: [] }, 4));
    assert.throws(() => normalize({ unit: null, cells: [] }, 4));
    assert.throws(() => normalize({ unit: 4, cells: [{ key: '15.1:temp' }] }, 4));
});
test('accuracy measured against human review, blanks never count as success', () => {
    const cells = [{ key: 'a', value: 0 }, { key: 'b', value: 10 }, { key: 'c', value: null }];
    assert.equal(metrics(cells, {}).accuracy, null);
    assert.deepEqual(metrics(cells, { a: 0, b: 11, c: 2 }), { total: 3, detected: 2, reviewed: 3, evaluable: 3, correct: 1, accuracy: 33.3 });
    assert.equal(metrics(cells, { c: null }).accuracy, null);
});
test('reject invalid formats and oversized bodies before model invocation', async () => {
    assert.throws(() => validateImage('https://example.com/photo.png'));
    assert.throws(() => validateImage('data:image/png;base64,YWJj'));
    await assert.rejects(readImageBody(Readable.from([Buffer.alloc(13 * 1024 * 1024)])), /límite/);
    await assert.rejects(readImageBody(Readable.from([Buffer.from('bad')])), /inválida/);
});
test('local route rejects remote origins, DNS rebinding and remote clients', () => {
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:4173', origin: 'http://localhost:4173' } };
    assert.equal(isLocal(req), true);
    assert.equal(isLocal({ ...req, headers: { ...req.headers, origin: 'https://evil.example' } }), false);
    assert.equal(isLocal({ ...req, headers: { host: 'evil.example' } }), false);
    assert.equal(isLocal({ ...req, socket: { remoteAddress: '10.0.0.1' } }), false);
});
test('provider request uses image, strict schema and nonstored response', async () => {
    const result = await extract({ unit: 4, image }, { provider: 'openai', apiKey: 'test', fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.store, false);
        assert.equal(body.text.format.strict, true);
        assert.equal(body.input[0].content[1].image_url, image);
        return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ unit: 4, cells: [{ key: '1.1:temp', value: 53.7, note: '' }] }) }] }] }) };
    } });
    assert.equal(result.cells[0].value, 53.7);
    assert.equal(result.cells.length, 89);
});
test('configuration, provider errors, truncation and refusal are actionable errors', async () => {
    await assert.rejects(extract({ unit: 4, image }, { provider: 'openai', apiKey: '' }), /OPENAI_API_KEY/);
    for (const result of [{ ok: false, status: 429 }, { ok: true, json: async () => ({ status: 'incomplete' }) }, { ok: true, json: async () => ({ status: 'completed', output: [] }) }]) {
        await assert.rejects(extract({ unit: 4, image }, { provider: 'openai', apiKey: 'test', fetchImpl: async () => result }));
    }
});
