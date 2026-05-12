import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://fygvulgffhxrimaeyoep.supabase.co','sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF');

const equipos = [
    { ut: '2893-11-MAE10-AP302--M01', unidad: 'U1' },
    { ut: '2893-21-MAE10-AP302--M01', unidad: 'U2' },
    { ut: '2893-31-MAE10-AP302--M01', unidad: 'U3' },
    { ut: '2893-41-MAE10-AP302--M01', unidad: 'U4' },
    { ut: '2893-51-MAE10-AP302--M01', unidad: 'U5' }
];

for (const eq of equipos) {
    const nuevoNombre = `Bomba Aceite Emergencia ${eq.unidad}`;
    const { data, error } = await sb.from('equipos')
        .update({ activo: nuevoNombre, ubicacion: eq.unidad })
        .eq('ubicacion_tecnica', eq.ut)
        .select('id, activo, ubicacion');
    if (error) console.log(`✗ ${eq.ut}: ${error.message}`);
    else console.log(`✓ ${eq.ut} → ${nuevoNombre}  (${data.length} filas)`);
}
