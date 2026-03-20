import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabase = createClient(supabaseUrl, supabaseKey);

async function searchEquipos() {
    const { data, error } = await supabase
        .from('equipos')
        .select('*')
        .or('activo.ilike.%ventilador%,activo.ilike.%tiro forzado%');

    if (error) {
        console.error('Error searching equipos:', error.message);
    } else {
        console.log(`Found ${data.length} matches in Database:`);
        data.forEach(item => console.log(JSON.stringify(item)));
    }
}

searchEquipos();
