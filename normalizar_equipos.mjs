import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabase = createClient(supabaseUrl, supabaseKey);

// Lee el JSON exportado por Python con todas las filas del Excel
const rows = JSON.parse(fs.readFileSync('equipos_excel_full.json', 'utf-8'));
console.log(`Filas únicas (por UT) en Excel: ${rows.length}`);

// Trae todos los equipos de la DB para resolver IDs por UT
async function fetchAll() {
    const all = [];
    let from = 0;
    const ps = 1000;
    while (true) {
        const { data, error } = await supabase.from('equipos').select('id, ubicacion_tecnica').range(from, from + ps - 1);
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
        utIndex.get(ut).push(e.id);
    }
}

const CHUNK = 50;
let totalUpdate = 0, totalInsert = 0, errores = 0;

for (let i = 0; i < rows.length; i += CHUNK) {
    const bloque = rows.slice(i, i + CHUNK);
    for (const r of bloque) {
        const ut = norm(r.ut);
        const payload = {
            activo: r.texto_breve,
            denominacion_ut: r.objeto || null,
            kks: ut,
            ubicacion_tecnica: ut,
            ubicacion: r.unidad || null,
            criticidad: 'MEDIA'
        };
        const ids = utIndex.get(ut);
        if (ids && ids.length) {
            // Update todos los registros con esa UT
            const { error } = await supabase.from('equipos').update(payload).in('id', ids);
            if (error) { errores++; console.log(`UPDATE ERR UT ${ut}: ${error.message}`); }
            else totalUpdate += ids.length;
        } else {
            // Insert
            const { error } = await supabase.from('equipos').insert([payload]);
            if (error) { errores++; console.log(`INSERT ERR UT ${ut}: ${error.message}`); }
            else totalInsert++;
        }
    }
    process.stdout.write(`\r  Procesados ${Math.min(i + CHUNK, rows.length)}/${rows.length}  (upd:${totalUpdate}  ins:${totalInsert}  err:${errores})`);
}
console.log('\n✓ Listo.');
console.log(`  UPDATE: ${totalUpdate} filas actualizadas`);
console.log(`  INSERT: ${totalInsert} filas nuevas`);
console.log(`  Errores: ${errores}`);
