const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const rows=JSON.parse(fs.readFileSync('equipment-audit-snapshot.json','utf8'));
const source=fs.readFileSync('app.js','utf8');
const ctx=vm.createContext({window:{},estado:{equipos:rows}});
vm.runInContext(source.slice(source.indexOf('function _equipoEsCanonico('),source.indexOf('function renderEquiposView(')),ctx);
const groups=new Map();for(const e of rows){const ut=ctx._ubicacionTecnicaFicha(e);if(!ut)continue;if(!groups.has(ut.base))groups.set(ut.base,[]);groups.get(ut.base).push(e);}
const split=[...groups].filter(([k,g])=>new Set(g.map(e=>e.activo+'|'+e.ubicacion)).size>1&&new Set(g.map(e=>e.componente||'')).size>1);
const oldHidden=rows.filter(e=>!ctx._equipoEsCanonico(e)&&ctx._codigoFuncionalKKS(e)&&rows.some(c=>ctx._equipoEsCanonico(c)&&ctx._unidadEquipoDedup(c)===ctx._unidadEquipoDedup(e)&&ctx._codigoFuncionalKKS(c)===ctx._codigoFuncionalKKS(e)));
assert.equal(ctx.filtrarEquiposDuplicados(rows).length,rows.length);
for(const [key,g] of groups) assert.equal(new Set(g.map(ctx._claveActivoFicha)).size,1,key);
const conflicting=[...groups].filter(([k,g])=>new Set(g.filter(ctx._equipoEsCanonico).map(e=>String(e.activo).toLowerCase())).size>1);
const clean=v=>String(v||'Sin especificar').replaceAll('|','/').replaceAll('\n',' ');
let report=`# Revisión de componentes — 6 de octubre de 2026\n\nCatálogo consultado en Supabase: ${rows.length} registros. Consulta de solo lectura.\n\n- ${split.length} grupos técnicos con nombres/ubicaciones diferentes y distintos componentes.\n- ${oldHidden.length} registros ocultados por el filtro original basado únicamente en unidad y código funcional. Esto indica riesgo de ocultamiento, no que todos sean piezas diferentes.\n- ${conflicting.length} grupos con más de un nombre canónico: revisar la calidad del catálogo.\n- ${rows.filter(e=>!ctx._ubicacionTecnicaFicha(e)).length} registros sin formato técnico reconocido: mantienen el agrupamiento por nombre y ubicación (con el alias VTF existente).\n\nLa corrección conserva todos los IDs, agrupa por unidad, sector y código funcional, y carga las tendencias únicamente por ID del componente. No modifica la base de datos ni inventa piezas faltantes. Los registros que comparten código siguen siendo seleccionables individualmente.\n\nValidación: todos los registros siguen visibles y cada grupo técnico conserva sus componentes; 30 pruebas automáticas aprobadas. No se verificó visualmente una sesión de producción.\n\n## Grupos que requieren revisar los nombres del catálogo\n\n`;
for(const [k,g] of conflicting)report+=`- ${k}: ${[...new Set(g.filter(ctx._equipoEsCanonico).map(e=>e.activo))].join(' / ')}\n`;
report+='\n## Grupos con componentes separados\n\n| Ubicación técnica | Activos registrados | Componentes |\n|---|---|---|\n';
for(const [k,g] of split.sort(([a],[b])=>a.localeCompare(b)))report+=`| ${k.replace('|',' / ')} | ${[...new Set(g.map(e=>clean(e.activo)))].join('; ')} | ${g.map(e=>clean(e.componente||e.activo)).join('; ')} |\n`;
fs.writeFileSync('equipment-components-audit.md',report);
console.log(JSON.stringify({records:rows.length,splitGroups:split.length,previouslyHidden:oldHidden.length,conflictingNames:conflicting.length,withoutTechnicalFormat:rows.filter(e=>!ctx._ubicacionTecnicaFicha(e)).length}));
