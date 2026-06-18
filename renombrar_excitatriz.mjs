import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://fygvulgffhxrimaeyoep.supabase.co','sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF');

// Escobillas Generador → Excitatriz (la unidad queda en el campo ubicacion).
const equipos = [
    { ut: '2893-31-MAK20-GR001--G03', unidad: 'U3' },
    { ut: '2893-41-MAK20-GR001--G03', unidad: 'U4' },
    { ut: '2893-51-MAK20-GR001--G03', unidad: 'U5' }
];

for (const eq of equipos) {
    const nuevoNombre = `Excitatriz ${eq.unidad}`;
    const { data, error } = await sb.from('equipos')
        .update({ activo: nuevoNombre, ubicacion: eq.unidad })
        .eq('ubicacion_tecnica', eq.ut)
        .select('id, activo, ubicacion, ubicacion_tecnica');
    if (error) console.log(`✗ ${eq.ut}: ${error.message}`);
    else console.log(`✓ ${eq.ut} → ${nuevoNombre}  (${data.length} fila${data.length !== 1 ? 's' : ''})`);
}
