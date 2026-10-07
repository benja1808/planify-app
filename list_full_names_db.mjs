import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listNames() {
    const { data, error } = await supabase
        .from('equipos')
        .select('activo')
        .ilike('activo', '%tiro%forzado%');

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('--- Matches in Database (Full Names) ---');
        data.forEach(item => {
            console.log(item.activo);
        });
    }
}

listNames();
