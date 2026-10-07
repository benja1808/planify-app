import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function searchEquipos() {
    const { data, error } = await supabase
        .from('equipos')
        .select('*')
        .ilike('activo', '%tiro%forzado%');

    if (error) {
        console.error('Error searching equipos:', error.message);
    } else {
        console.log(`Found ${data.length} specific matches in Database:`);
        data.forEach(item => console.log(JSON.stringify(item)));
    }
}

searchEquipos();
