import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function countEquipos() {
    const { count, error } = await supabase
        .from('equipos')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Error counting equipos:', error.message);
    } else {
        console.log(`Total equipos en la base de datos: ${count}`);
    }
}

countEquipos();
