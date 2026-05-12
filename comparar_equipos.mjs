import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchAllEquipos() {
    const all = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
        const { data, error } = await supabase.from('equipos').select('*').range(from, from + pageSize - 1);
        if (error) { console.error('Err:', error); break; }
        if (!data || !data.length) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

const programa = JSON.parse(fs.readFileSync('equipos_programa.json', 'utf-8'));
console.log(`Equipos del Excel: ${programa.length}`);

const dbEquipos = await fetchAllEquipos();
console.log(`Equipos en DB: ${dbEquipos.length}`);

const norm = v => String(v || '').trim().toUpperCase();
const utIdx = new Map();
for (const e of dbEquipos) {
    const ut = norm(e.ubicacion_tecnica);
    if (ut) utIdx.set(ut, e);
    const utp = norm(e.ubicacion_tecnica_propuesta);
    if (utp && !utIdx.has(utp)) utIdx.set(utp, e);
}

const existentes = [];
const nuevos = [];
for (const eq of programa) {
    const ut = norm(eq.ut);
    if (utIdx.has(ut)) {
        existentes.push({ ...eq, match: utIdx.get(ut).activo });
    } else {
        nuevos.push(eq);
    }
}

console.log(`\n✓ Ya existen en DB: ${existentes.length}`);
console.log(`+ Nuevos a insertar: ${nuevos.length}`);

console.log('\n--- Muestra de existentes ---');
for (const e of existentes.slice(0, 5)) {
    console.log(`  Excel "${e.nombre}" UT ${e.ut}  →  DB "${e.match}"`);
}

console.log('\n--- Muestra de nuevos por unidad ---');
const porUnidad = {};
for (const e of nuevos) {
    porUnidad[e.unidad] = (porUnidad[e.unidad] || 0) + 1;
}
for (const [u, n] of Object.entries(porUnidad).sort()) {
    console.log(`  ${u || '(vacío)'}: ${n}`);
}

fs.writeFileSync('equipos_existentes.json', JSON.stringify(existentes, null, 2));
fs.writeFileSync('equipos_nuevos.json', JSON.stringify(nuevos, null, 2));
console.log('\nGuardado en equipos_existentes.json y equipos_nuevos.json');
