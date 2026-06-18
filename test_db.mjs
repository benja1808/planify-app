import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fygvulgffhxrimaeyoep.supabase.co';
const supabaseKey = 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTareas() {
    const { data, error } = await supabase.from('tareas').select('id, tipo, lider_id, estado_tarea, ot_numero, created_at, ubicacion').eq('ot_numero', '2002175002');
    console.log("Tasks with OT 2002175002:", data);
}

checkTareas();
