import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
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
