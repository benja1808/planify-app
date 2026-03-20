// Script de importación de Frecuencias.xlsx → Supabase tabla "equipos"
// Ejecutar UNA SOLA VEZ con: node importar_equipos_frecuencias.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { read, utils } from 'xlsx';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabase = createClient(supabaseUrl, supabaseKey);

// Leer Excel
const fileBuffer = readFileSync('./Frecuencias.xlsx');
const wb = read(fileBuffer, { type: 'buffer' });
const ws = wb.Sheets['Vibraciones'];
const rows = utils.sheet_to_json(ws, { header: 1 });

// Saltar la fila de headers (índice 0)
const equipos = rows.slice(1)
    .filter(row => row[3]) // Solo filas con "Activo" (col D)
    .map(row => ({
        ruta:              row[0] ? String(row[0]).trim() : null,
        kks:               row[1] ? String(row[1]).trim() : null,
        ubicacion:         row[2] ? String(row[2]).trim() : null,
        activo:            row[3] ? String(row[3]).trim() : null,
        componente:        row[4] ? String(row[4]).trim() : null,
        ubicacion_tecnica: row[5] ? String(row[5]).trim() : null,
        denominacion_ut:   row[6] ? String(row[6]).trim() : null,
        criticidad:        row[7] ? String(row[7]).trim() : null,
        frecuencia_nueva:  (row[8] !== undefined && row[8] !== null && row[8] !== '') ? parseInt(row[8]) || null : null,
    }));

console.log(`Total equipos a importar: ${equipos.length}`);
console.log('Muestra fila 1:', JSON.stringify(equipos[0]));

// Insertar en lotes de 100 para no saturar la API
const BATCH_SIZE = 100;
let insertados = 0;
let errores = 0;

for (let i = 0; i < equipos.length; i += BATCH_SIZE) {
    const lote = equipos.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('equipos').insert(lote);
    
    if (error) {
        console.error(`\n❌ Error en lote ${i}-${i + BATCH_SIZE}:`, error.message);
        errores++;
    } else {
        insertados += lote.length;
        process.stdout.write(`\r✅ Insertados: ${insertados}/${equipos.length}`);
    }
}

console.log(`\n\n=== IMPORTACIÓN COMPLETADA ===`);
console.log(`✅ Equipos insertados: ${insertados}`);
if (errores > 0) console.log(`❌ Lotes con error: ${errores}`);
