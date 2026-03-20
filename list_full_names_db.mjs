import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
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
