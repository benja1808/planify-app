import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const db=createClient(SUPABASE_URL,SUPABASE_KEY); let rows=[];
for(let offset=0;;offset+=1000){const {data,error}=await db.from('equipos').select('id,activo,ubicacion,kks,componente,denominacion_ut').order('id').range(offset,offset+999); if(error)throw error; rows.push(...data); if(data.length<1000)break;}
fs.writeFileSync('equipment-audit-snapshot.json',JSON.stringify(rows,null,2));
console.log('Equipos consultados:',rows.length);
