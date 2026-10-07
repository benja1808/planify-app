import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
// Aplica la migración avisos_sap.sql usando supabase-js (vía rpc 'exec_sql' si existe,
// o intentando insertar para detectar si la tabla ya existe).
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// Intentar leer la tabla; si no existe, dará error 42P01.
const { error } = await sb.from('avisos_sap').select('id').limit(1);
if (!error) {
    console.log('✓ Tabla avisos_sap ya existe.');
    process.exit(0);
}
console.log('✗ Tabla avisos_sap NO existe. Error:', error.message);
console.log('\nLa anon key no puede ejecutar DDL.');
console.log('Pega manualmente este SQL en el SQL Editor de Supabase:');
console.log('  → supabase/migrations/20260512200000_avisos_sap.sql');
console.log('\nDespués corre: node cargar_avisos_sap.mjs');
