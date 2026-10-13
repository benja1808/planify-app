(function (root) {
    'use strict';
    const extras = ['hum', 'tamb', 'gen', 'vcampo', 'icampo'];
    function keys(unit) {
        if (![3, 4, 5].includes(Number(unit))) throw new Error('Unidad no soportada.');
        return Array.from({ length: 14 }, (_, i) => Array.from({ length: Number(unit) === 3 ? 4 : 3 }, (_, j) =>
            [`${i + 1}.${j + 1}:temp`, `${i + 1}.${j + 1}:corr`])).flat(2).concat(extras);
    }
    function number(value) {
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        const text = String(value).trim().replace(',', '.');
        return /^-?\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
    }
    function normalize(raw, unit) {
        if (!raw || !Array.isArray(raw.cells)) throw new Error('El lector no devolvió una tabla válida.');
        if (Number(raw.unit) !== Number(unit)) throw new Error('La unidad de la foto no coincide o no pudo identificarse. Usa una foto que muestre la unidad.');
        const expected = keys(unit);
        const known = new Set(expected);
        if (raw.cells.some(c => !c || !known.has(c.key))) throw new Error('La imagen contiene posiciones inesperadas. Revisa la unidad y la hoja.');
        return expected.map(key => {
            const matches = raw.cells.filter(c => c.key === key);
            const cell = matches.length === 1 ? matches[0] : null;
            const value = number(cell?.value);
            return { key, value, review: true, reason: matches.length > 1 ? 'Posición duplicada: revisar en la foto' :
                value === null ? 'Ausente o ilegible' : String(cell?.note || 'Verificar con la foto').slice(0, 180) };
        });
    }
    function metrics(cells, reviewed) {
        const checked = cells.filter(c => Object.hasOwn(reviewed, c.key));
        const evaluable = checked.filter(c => number(reviewed[c.key]) !== null);
        const correct = evaluable.filter(c => c.value !== null && c.value === number(reviewed[c.key])).length;
        return { total: cells.length, detected: cells.filter(c => c.value !== null).length,
            reviewed: checked.length, evaluable: evaluable.length, correct,
            accuracy: evaluable.length ? Math.round(correct / evaluable.length * 1000) / 10 : null };
    }
    const api = { keys, normalize, number, metrics, extras };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ExcitatrizOCR = api;
})(typeof window !== 'undefined' ? window : globalThis);
