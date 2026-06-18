// Snapshot de equipos: detecta unidad (2893-N | GUA-N | "Unidad N" | "U N")
// y marca origen 'canon' (kks GUA# o ruta R.VENT) vs '2893'.
const url='https://fygvulgffhxrimaeyoep.supabase.co';
const key='sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
import fs from 'fs';
let all=[],from=0,size=1000;
while(true){
  const r=await fetch(`${url}/rest/v1/equipos?select=id,activo,ubicacion,kks,componente,denominacion_ut,ruta`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Range:`${from}-${from+size-1}`}});
  const d=await r.json(); if(!Array.isArray(d)||d.length===0)break; all=all.concat(d); if(d.length<size)break; from+=size;
}
function unidadDe(e){
  const s=`${e.kks||''} ${e.denominacion_ut||''} ${e.ubicacion_tecnica||''}`;
  let m=s.match(/2893-(\d)/); if(m&&m[1]>='1'&&m[1]<='5')return 'U'+m[1];
  m=String(e.kks||'').match(/GUA(\d)/i); if(m&&m[1]>='1'&&m[1]<='5')return 'U'+m[1];
  m=String(e.ubicacion||'').match(/UNIDAD\s*([1-5])/i); if(m)return 'U'+m[1];
  m=String(e.ubicacion||'').match(/\bU\s*([1-5])\b/i); if(m)return 'U'+m[1];
  return '?';
}
function origenDe(e){ return (/GUA\d/i.test(e.kks||'')||/R\.VENT/i.test(e.ruta||'')) ? 'canon' : '2893'; }
const map={};
for(const e of all){
  const u=unidadDe(e); const k=u+'||'+e.activo+'||'+origenDe(e);
  (map[k]=map[k]||{unidad:u,activo:e.activo,origen:origenDe(e),componentes:new Set(),ubicacion:e.ubicacion});
  if(e.componente)map[k].componentes.add(e.componente);
}
const arr=Object.values(map).map(x=>({...x,componentes:[...x.componentes]}));
fs.writeFileSync('_app_equipos.json',JSON.stringify(arr,null,1));
const byU={};for(const e of arr){(byU[e.unidad]=byU[e.unidad]||{canon:0,d2893:0});if(e.origen==='canon')byU[e.unidad].canon++;else byU[e.unidad].d2893++;}
console.log('grupos:',arr.length);console.log(byU);
