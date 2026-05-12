import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabase = createClient(supabaseUrl, supabaseKey);

const rows = JSON.parse(fs.readFileSync('equipos_excel_full.json', 'utf-8'));
console.log(`Filas a corregir: ${rows.length}`);

const norm = v => String(v || '').trim().toUpperCase();

let updates = 0, errs = 0;
const total = rows.length;

for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ut = norm(r.ut);
    // INVERTIR: activo = Objeto (nombre del equipo físico),
    //           denominacion_ut = Texto breve (descripción de la tarea de mantenimiento)
    const payload = {
        activo: r.objeto,
        denominacion_ut: r.texto_breve || null,
        kks: ut,
        ubicacion_tecnica: ut,
        ubicacion: r.unidad || null
    };
    const { error } = await supabase.from('equipos').update(payload).eq('ubicacion_tecnica', ut);
    if (error) { errs++; console.log(`ERR UT ${ut}: ${error.message}`); }
    else updates++;
    if ((i + 1) % 50 === 0 || i + 1 === total) {
        process.stdout.write(`\r  ${i+1}/${total}  (ok:${updates}  err:${errs})`);
    }
}
console.log(`\n✓ Listo. Actualizados: ${updates}, errores: ${errs}`);
