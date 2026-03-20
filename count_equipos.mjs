import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
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
