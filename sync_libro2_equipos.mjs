import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const sb = createClient('https://fygvulgffhxrimaeyoep.supabase.co','sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF');

const rutas = JSON.parse(fs.readFileSync('libro2_rutas.json', 'utf-8'));
// Equipos únicos por UT
const equiposMap = new Map();
for (const r of rutas) {
    for (const e of r.equipos) {
        const ut = String(e.ubicacion_tecnica || '').trim();
        if (!ut) continue;
        if (!equiposMap.has(ut.toUpperCase())) {
            equiposMap.set(ut.toUpperCase(), { nombre: e.nombre, ut, unidad: e.unidad });
        }
    }
}
const equipos = [...equiposMap.values()];
console.log(`Equipos únicos en Libro2: ${equipos.length}`);

// Traer todos los equipos de la DB
async function fetchAll() {
    const all = [];
    let from = 0; const ps = 1000;
    while (true) {
        const { data, error } = await sb.from('equipos').select('id, activo, kks, ubicacion_tecnica, ubicacion').range(from, from + ps - 1);
        if (error) { console.error(error); break; }
        if (!data?.length) break;
        all.push(...data);
        if (data.length < ps) break;
        from += ps;
    }
    return all;
}
const dbEq = await fetchAll();
console.log(`Equipos en DB: ${dbEq.length}`);

const norm = v => String(v || '').trim().toUpperCase();
const utIndex = new Map();
for (const e of dbEq) {
    const ut = norm(e.ubicacion_tecnica);
    if (ut) {
        if (!utIndex.has(ut)) utIndex.set(ut, []);
        utIndex.get(ut).push(e);
    }
}

let creados = 0, actualizados = 0, sinCambios = 0, errs = 0;
const nuevosInsert = [];

for (const eq of equipos) {
    const ut = norm(eq.ut);
    const existentes = utIndex.get(ut);
    if (existentes && existentes.length) {
        // Existe → completar datos faltantes (kks, ubicacion_tecnica, ubicacion)
        for (const dbE of existentes) {
            const patch = {};
            if (!dbE.kks || !String(dbE.kks).trim()) patch.kks = eq.ut;
            if (!dbE.ubicacion_tecnica || !String(dbE.ubicacion_tecnica).trim()) patch.ubicacion_tecnica = eq.ut;
            if (!dbE.ubicacion || !String(dbE.ubicacion).trim()) patch.ubicacion = eq.unidad || null;
            if (Object.keys(patch).length) {
                const { error } = await sb.from('equipos').update(patch).eq('id', dbE.id);
                if (error) { errs++; console.log(`UPD ERR ${ut}: ${error.message}`); }
                else actualizados++;
            } else {
                sinCambios++;
            }
        }
    } else {
        nuevosInsert.push({
            activo: eq.nombre,
            kks: eq.ut,
            ubicacion_tecnica: eq.ut,
            ubicacion: eq.unidad || null,
            componente: '',
            criticidad: 'MEDIA'
        });
    }
}

// Insertar nuevos en bloques
for (let i = 0; i < nuevosInsert.length; i += 100) {
    const bloque = nuevosInsert.slice(i, i + 100);
    const { data, error } = await sb.from('equipos').insert(bloque).select('id');
    if (error) { errs++; console.log(`INS ERR bloque ${i/100+1}: ${error.message}`); }
    else creados += (data?.length || bloque.length);
}

console.log(`\n✓ Resultado:`);
console.log(`  Creados (nuevos):       ${creados}`);
console.log(`  Actualizados (kks/etc): ${actualizados}`);
console.log(`  Ya completos:           ${sinCambios}`);
console.log(`  Errores:                ${errs}`);
