(function (root, factory) {
    const createStore = factory();
    if (typeof module === 'object' && module.exports) module.exports = createStore;
    else root.RouteExecutionStore = createStore(root.localStorage, root.sessionStorage, () => {
        if (root.crypto.randomUUID) return root.crypto.randomUUID();
        const bytes = root.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    });
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    return function createStore(storage, selectionStorage, uuid) {
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
                _dirty: dirty || !!previous?._dirty, _revision: (previous?._revision || 0) + (dirty ? 1 : 0) };
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
            if (e._revision === revision) e._dirty = false;
            write(s);
        }
        function merge(remote, snapshot = null) {
            const s = state(); const next = {};
            remote.forEach(e => { if (!s.removed.includes(e.id)) next[e.id] = { ...e, _new: false, _dirty: false, _revision: s.entries[e.id]?._revision || 0 }; });
            Object.values(s.entries).forEach(e => { if (e._dirty || e._new || (snapshot && snapshot[e.id] !== e._revision)) next[e.id] = e; });
            s.entries = next; write(s);
        }
        return { all, list, selected, select, projection, put, remove, acknowledged, merge, newId: uuid,
            get: id => state().entries[id] || null };
    };
});
