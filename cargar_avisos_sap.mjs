// Carga inicial de avisos desde Avisos NAVARRETO00C.xlsx a Supabase.
// Usar UNA vez después de aplicar la migración SQL. Idempotente:
// los duplicados por nro_notificacion se descartan (on_conflict_do_nothing
// emulado leyendo lo que ya existe).
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const sb = createClient(
    'https://fygvulgffhxrimaeyoep.supabase.co',
    'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF'
);

const EXCEL_PATH = 'C:/Users/benja/Downloads/Avisos NAVARRETO00C.xlsx';

function parseFechaNotif(s) {
    // "20260512" → "2026-05-12"
    const v = String(s || '').trim();
    if (/^\d{8}$/.test(v)) return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
    if (typeof s === 'number') {
        const ms = (s - 25569) * 86400000;
        const d = new Date(ms);
        return !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : null;
    }
    if (s instanceof Date && !isNaN(s.getTime())) return s.toISOString().slice(0,10);
    return null;
}
function parseFechaCreacion(s) {
    if (typeof s === 'number' && isFinite(s)) {
        const d = new Date((s - 25569) * 86400000);
        return !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : null;
    }
    if (s instanceof Date && !isNaN(s.getTime())) return s.toISOString().slice(0,10);
    if (typeof s === 'string' && s.trim()) return parseFechaNotif(s);
    return null;
}

console.log('Leyendo Excel:', EXCEL_PATH);
const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
console.log('Filas en hoja:', rows.length);

const datos = [];
for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nro = String(r[6] || '').trim();
    if (!nro) continue;
    const fecha = parseFechaNotif(r[0]);
    if (!fecha) { console.log(`Fila ${i} sin fecha válida (notif=${nro}), salto`); continue; }
    datos.push({
        fecha_notif: fecha,
        indicador_abc: String(r[1] || '').trim() || null,
        prioridad: String(r[2] || '').trim() || null,
        clase_aviso: String(r[3] || '').trim() || null,
        pto_trabajo: String(r[4] || '').trim() || null,
        parada: !!String(r[5] || '').trim(),
        nro_notificacion: nro,
        orden: String(r[7] || '').trim() || null,
        ubicacion_tecnica: String(r[8] || '').trim() || null,
        descripcion_original: String(r[12] || '').trim() || null,
        autor: String(r[13] || '').trim() || null,
        fecha_creacion: parseFechaCreacion(r[14]),
        status_sistema: String(r[15] || '').trim() || null,
        autor_aviso: String(r[16] || '').trim() || null,
        status_usuario: String(r[17] || '').trim() || null
    });
}
console.log(`Avisos a procesar: ${datos.length}`);

// Warm-up del schema cache de PostgREST
const { error: warmErr } = await sb.from('avisos_sap').select('id').limit(1);
if (warmErr) {
    console.log('⚠ schema cache warmup falló:', warmErr.message);
    console.log('Forzando reload via REST...');
}

// Insertar en bloques con upsert por nro_notificacion (ignorando si ya existe).
const CHUNK = 100;
let inserted = 0, errores = 0;
for (let i = 0; i < datos.length; i += CHUNK) {
    const bloque = datos.slice(i, i + CHUNK);
    const { data, error } = await sb.from('avisos_sap')
        .upsert(bloque, { onConflict: 'nro_notificacion', ignoreDuplicates: true })
        .select('id');
    if (error) {
        errores++;
        console.log(`✗ Bloque ${i/CHUNK + 1}: ${error.message}`);
        if (i === 0) {
            console.log('\n⚠ La tabla probablemente no existe. Ejecuta primero:');
            console.log('  supabase/migrations/20260512200000_avisos_sap.sql');
            process.exit(1);
        }
    } else {
        inserted += (data?.length || 0);
        process.stdout.write(`\r  ${Math.min(i+CHUNK, datos.length)}/${datos.length}  insertados:${inserted}`);
    }
}
console.log(`\n✓ Insertados/actualizados: ${inserted}`);

// Vincular con equipos por ubicacion_tecnica
console.log('\nVinculando con maestro de equipos por UT...');
const { data: equipos } = await sb.from('equipos').select('id, ubicacion_tecnica');
const idxEq = new Map();
(equipos || []).forEach(e => {
    const ut = String(e.ubicacion_tecnica || '').trim().toUpperCase();
    if (ut && !idxEq.has(ut)) idxEq.set(ut, e.id);
});
const { data: avisos } = await sb.from('avisos_sap').select('id, ubicacion_tecnica, equipo_id');
let vinc = 0;
for (const a of (avisos || [])) {
    if (a.equipo_id) continue;
    const eqId = idxEq.get(String(a.ubicacion_tecnica || '').trim().toUpperCase());
    if (!eqId) continue;
    const { error } = await sb.from('avisos_sap').update({ equipo_id: eqId }).eq('id', a.id);
    if (!error) vinc++;
}
console.log(`✓ Avisos vinculados con equipo_id: ${vinc}`);
console.log(`\nResumen: ${inserted} avisos insertados, ${vinc} vinculados.`);
