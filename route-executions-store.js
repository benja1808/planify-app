(function (root, factory) {
    const createStore = factory();
    if (typeof module === 'object' && module.exports) module.exports = createStore;
    else root.RouteExecutionSync = createStore.sync;
    if (!(typeof module === 'object' && module.exports)) root.RouteExecutionStore = createStore(root.localStorage, root.sessionStorage, () => {
        if (root.crypto.randomUUID) return root.crypto.randomUUID();
        const bytes = root.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    });
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    // Varias personas capturan la misma OT a la vez: los mapas se sincronizan
    // clave por clave (componente "eq.comp"), nunca reemplazando el objeto entero.
    const MAPS = ['componentesEstado', 'componentesAt', 'observaciones', 'mediciones'];
    const SCALARS = ['ot', 'fechaInicio', 'fechaCierre', 'estado', 'tecnicosIds', 'tecnicosNombres', 'liderId', 'liderNombre', 'ayudanteId', 'ayudanteNombre'];
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function snap(e) {
        const o = {};
        MAPS.forEach(m => { o[m] = clone(e?.[m] || {}); });
        SCALARS.forEach(k => { if (e && e[k] !== undefined) o[k] = clone(e[k]); });
        return o;
    }
    // Cambios de `local` respecto de `base`: claves nuevas o modificadas, claves borradas y campos simples.
    function diff(local, base) {
        const d = { set: {}, del: {}, campos: {} };
        const b = base || {};
        MAPS.forEach(m => {
            const L = local?.[m] || {}, B = b[m] || {};
            Object.keys(L).forEach(k => { if (!same(L[k], B[k])) (d.set[m] = d.set[m] || {})[k] = clone(L[k]); });
            Object.keys(B).forEach(k => { if (!(k in L)) (d.del[m] = d.del[m] || []).push(k); });
        });
        SCALARS.forEach(k => { if (local && local[k] !== undefined && !same(local[k], b[k])) d.campos[k] = clone(local[k]); });
        return d;
    }
    const isEmpty = d => !Object.keys(d.set).length && !Object.keys(d.del).length && !Object.keys(d.campos).length;
    function apply(target, d) {
        const out = { ...(target || {}) };
        MAPS.forEach(m => {
            const cur = { ...((target || {})[m] || {}) };
            Object.entries(d.set[m] || {}).forEach(([k, v]) => { cur[k] = clone(v); });
            (d.del[m] || []).forEach(k => { delete cur[k]; });
            out[m] = cur;
        });
        Object.entries(d.campos).forEach(([k, v]) => { out[k] = clone(v); });
        return out;
    }
    // Lo sincronizado viene del servidor; el resto (rutaIdx, marcas locales) se conserva.
    const withRemote = (local, remote) => {
        const out = { ...local };
        MAPS.forEach(m => { out[m] = clone(remote[m] || {}); });
        SCALARS.forEach(k => { if (remote[k] !== undefined) out[k] = clone(remote[k]); });
        return out;
    };
    const createStore = function createStore(storage, selectionStorage, uuid) {
        const KEY = 'planify_rutas_ejecuciones_v2';
        const LEGACY = 'planify_rutas_ejecuciones';
        const SELECTED = 'planify_rutas_seleccionadas_v2';
        const read = (key, source = storage) => JSON.parse(source.getItem(key) || 'null');
        function state() {
            const existing = read(KEY);
            if (existing) return existing;
            const initial = { entries: {}, removed: [] };
            Object.entries(read(LEGACY) || {}).forEach(([idx, ej]) => {
                if (!ej || ['cerrada', 'cancelada'].includes(ej.estado)) return;
                const id = ej.id || uuid();
                initial.entries[id] = { ...ej, id, rutaIdx: Number(idx), _new: !ej.id, _dirty: !ej.id, _revision: 0 };
            });
            storage.setItem(KEY, JSON.stringify(initial));
            return initial;
        }
        function all() { return Object.values(state().entries).filter(e => !['cerrada', 'cancelada'].includes(e.estado)); }
        function list(idx) { return all().filter(e => e.rutaIdx === Number(idx)); }
        function selected(idx) {
            const id = (read(SELECTED, selectionStorage) || {})[idx];
            return id ? list(idx).find(e => e.id === id) || null : list(idx)[0] || null;
        }
        function select(idx, id) {
            if (!list(idx).some(e => e.id === id)) return false;
            selectionStorage.setItem(SELECTED, JSON.stringify({ ...(read(SELECTED, selectionStorage) || {}), [idx]: id }));
            return true;
        }
        function projection() { return Object.fromEntries([...new Set(all().map(e => e.rutaIdx))].map(idx => [idx, selected(idx)]).filter(([,e]) => e)); }
        function write(s) {
            storage.setItem(KEY, JSON.stringify(s));
            // Compatibility cache for older read-only consumers. Never the source of truth.
            storage.setItem(LEGACY, JSON.stringify(projection()));
        }
        function put(idx, ej, { dirty = true, choose = false } = {}) {
            const s = state();
            const id = ej.id || uuid();
            if (s.removed.includes(id)) throw new Error('Esta ejecución ya fue cerrada. Actualiza las rutas.');
            const previous = s.entries[id];
            const next = { ...ej, id, rutaIdx: Number(idx), _new: previous?._new ?? ej._new ?? !ej.id,
                _dirty: dirty || !!previous?._dirty, _revision: (previous?._revision || 0) + (dirty ? 1 : 0),
                // La base (última versión conocida del servidor) la mantiene el store, no quien llama.
                _base: previous ? previous._base : ej._base };
            if (Object.values(s.entries).some(other => other.id !== id && other.rutaIdx === next.rutaIdx && (other.componentesEstado?.__vibDiaria?.fecha || '') === (next.componentesEstado?.__vibDiaria?.fecha || '') && String(other.ot || '').trim().toUpperCase() === String(next.ot || '').trim().toUpperCase())) {
                throw new Error('Ya hay una ejecución abierta de esta ruta con esa OT.');
            }
            s.entries[id] = next;
            storage.setItem(KEY, JSON.stringify(s));
            if (choose) select(idx, id);
            write(s);
            return next;
        }
        function remove(id) {
            const s = state();
            delete s.entries[id];
            if (!s.removed.includes(id)) s.removed.push(id);
            write(s);
        }
        function acknowledged(id, revision) {
            const s = state(); const e = s.entries[id];
            if (!e) return;
            e._new = false;
            if (e._revision === revision) { e._dirty = false; e._base = snap(e); }
            write(s);
        }
        // Integra la fila que devolvió el servidor tras aplicar `pushed`, conservando
        // lo que este dispositivo editó mientras el envío estaba en curso.
        function confirmServer(id, revision, remote, pushed) {
            const s = state(); const e = s.entries[id];
            if (!e) return null;
            const remaining = diff(e, apply(e._base || {}, pushed));
            const next = apply(withRemote(e, remote), remaining);
            next._base = snap(remote);
            next._new = false;
            next._dirty = !isEmpty(remaining) || e._revision !== revision;
            s.entries[id] = next; write(s);
            return next;
        }
        function merge(remote, snapshot = null) {
            const s = state(); const next = {};
            remote.forEach(r => {
                if (s.removed.includes(r.id)) return;
                const local = s.entries[r.id];
                if (local && snapshot && snapshot[r.id] !== local._revision) { next[r.id] = local; return; }
                if (local && (local._dirty || local._new)) {
                    // Lo del servidor (otros dispositivos) + lo pendiente de este dispositivo.
                    const pending = diff(local, local._base);
                    next[r.id] = { ...apply(withRemote(local, r), pending), _new: false, _dirty: !isEmpty(pending), _revision: local._revision, _base: snap(r) };
                    return;
                }
                next[r.id] = { ...r, _new: false, _dirty: false, _revision: local?._revision || 0, _base: snap(r) };
            });
            Object.values(s.entries).forEach(e => { if (!next[e.id] && (e._dirty || e._new || (snapshot && snapshot[e.id] !== e._revision))) next[e.id] = e; });
            s.entries = next; write(s);
        }
        return { all, list, selected, select, projection, put, remove, acknowledged, confirmServer, merge, newId: uuid,
            get: id => state().entries[id] || null };
    };
    createStore.sync = { diff, apply, isEmpty, snap, MAPS, SCALARS };
    return createStore;
});
