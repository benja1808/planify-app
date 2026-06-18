import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://fygvulgffhxrimaeyoep.supabase.co','sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF');
const { data: tareas, count } = await sb.from('tareas').select('*', { count: 'exact' });
console.log('Total tareas en el tablero AHORA:', tareas.length);
const ids = ['5b602236-bbb4-4cde-986d-26f4ad831b34','6e2fc4ab-2243-4652-bb9e-fa37fd9e5fa9','c3e54ce4-45ad-406e-a74e-110c747a8db2'];
const carb = tareas.filter(t => ids.includes(t.id));
console.log('Las 3 de Carbones U3/U4/U5 siguen presentes:', carb.length);
carb.forEach(t => console.log('  •', t.tipo, '| OT:', t.ot_numero, '| id:', t.id));
