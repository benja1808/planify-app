import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listNames() {
    const { data, error } = await supabase
        .from('equipos')
        .select('activo, kks, ubicacion')
        .ilike('activo', '%tiro%forzado%');

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('--- Matches in Database ---');
        data.forEach(item => {
            console.log(`Activo: ${item.activo} | KKS: ${item.kks} | Ubicación: ${item.ubicacion}`);
        });
    }
}

listNames();
