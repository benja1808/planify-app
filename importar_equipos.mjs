import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runImport() {
    console.log("Reading Excel...");
    const workbook = xlsx.readFile('Frecuencias.xlsx');
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`Found ${data.length} rows in Excel.`);

    const uniqueUbicaciones = new Set();
    data.forEach(row => {
        if (row['Ubicación']) uniqueUbicaciones.add(row['Ubicación'].trim());
    });

    const ubicacionesArray = Array.from(uniqueUbicaciones).map(name => ({ nombre: name }));
    
    console.log(`Inserting ${ubicacionesArray.length} unique ubicaciones...`);
    const { data: insertedUbis, error: ubiError } = await supabase
        .from('ubicaciones')
        .upsert(ubicacionesArray, { onConflict: 'nombre' })
        .select();

    if (ubiError) {
        console.error("Error inserting ubicaciones:", ubiError);
        return;
    }

    // Map names to UUIDs
    const ubiMap = {};
    insertedUbis.forEach(u => ubiMap[u.nombre] = u.id);

    // Prepare equipos data
    const equiposData = data.map(row => {
        const ubiName = row['Ubicación'] ? row['Ubicación'].trim() : null;
        return {
            ubicacion_id: ubiName ? ubiMap[ubiName] : null,
            ruta: row['Ruta'] ? String(row['Ruta']) : null,
            kks: row['KKS'] ? String(row['KKS']) : 'SIN_KKS',
            ubicacion_original: row['Ubicación'] ? String(row['Ubicación']) : null,
            activo: row['Activo'] ? String(row['Activo']) : 'Desconocido',
            componente: row['Componente'] ? String(row['Componente']) : null,
            ubicacion_tecnica_propuesta: row['UBICACIÓN TECNICA PROPUESTA'] ? String(row['UBICACIÓN TECNICA PROPUESTA']) : null,
            denominacion_ut: row['DENOMINACION UT'] ? String(row['DENOMINACION UT']) : null,
            criticidad: row['Criticidad'] ? String(row['Criticidad']) : null,
            frecuencia_nueva: row['FRECUENCIA NUEVA'] ? String(row['FRECUENCIA NUEVA']) : null
        };
    }).filter(e => e.kks !== 'SIN_KKS'); // Basic validation

    console.log(`Prepared ${equiposData.length} equipos for insertion.`);

    // Cleaning existing records to avoid duplicates if script is run twice
    console.log("Cleaning old equipos records...");
    await supabase.from('equipos').delete().neq('kks', 'placeholder');

    // Batch insertion
    const batchSize = 500;
    for (let i = 0; i < equiposData.length; i += batchSize) {
        const batch = equiposData.slice(i, i + batchSize);
        console.log(`Inserting batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(equiposData.length / batchSize)}...`);
        const { error: eqError } = await supabase.from('equipos').insert(batch);
        if (eqError) {
            console.error("Error inserting batch:", eqError);
        }
    }

    console.log("Import Complete!");
}

runImport();
