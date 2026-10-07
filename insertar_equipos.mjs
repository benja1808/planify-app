import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const nuevos = JSON.parse(fs.readFileSync('equipos_nuevos.json', 'utf-8'));
console.log(`Equipos a insertar: ${nuevos.length}`);

// Inserción en bloques de 100 para no saturar
const CHUNK = 100;
let total = 0, errores = 0;
const erroresLog = [];

for (let i = 0; i < nuevos.length; i += CHUNK) {
    const bloque = nuevos.slice(i, i + CHUNK);
    const payload = bloque.map(e => ({
        activo: e.nombre,
        kks: e.ut,                    // KKS = UT del Excel
        ubicacion_tecnica: e.ut,      // y también en ubicacion_tecnica
        ubicacion: e.unidad || null,
        componente: '',
        criticidad: 'MEDIA'
    }));
    const { data, error } = await supabase.from('equipos').insert(payload).select('id');
    if (error) {
        console.log(`  Bloque ${i / CHUNK + 1}: ERROR — ${error.message}`);
        errores += bloque.length;
        erroresLog.push({ bloque: i / CHUNK + 1, error: error.message, primer_equipo: bloque[0]?.nombre });
    } else {
        total += (data?.length || bloque.length);
        process.stdout.write(`\r  Insertados: ${total} / ${nuevos.length}`);
    }
}
console.log(`\n✓ Total insertados: ${total}`);
console.log(`✗ Errores: ${errores}`);
if (erroresLog.length) {
    console.log('Detalle de errores:');
    erroresLog.forEach(e => console.log(`  - Bloque ${e.bloque}: ${e.error}`));
}
