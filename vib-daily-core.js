(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.VibDailyCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const ut = s => norm(s).replace(/\s/g, ''); // Double hyphens in motor KKS are significant.
    const fields = ['componentesEstado', 'componentesAt', 'mediciones', 'observaciones'];
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const importColumns = ['unidad','activo','nombre','ubicacion_tecnica','disponible','ot','observacionOperaciones'];
    function recoveryText(pages) {
        return pages.flatMap(page=>{
            const lines=[];
            for(const item of page.items.filter(i=>i.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5])) {
                let line=lines.find(l=>Math.abs(l.y-item.transform[5])<2);
                if(!line){line={y:item.transform[5],items:[]};lines.push(line);}
                line.items.push(item);
            }
            return lines.map(l=>l.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str.trim().replace(/[\t\r\n]+/g,' ')).join('\t'));
        }).join('\n');
    }
    function parseRecovery(text, mapping) {
        const selected=importColumns.map(k=>mapping[k]).filter(v=>Number.isInteger(v) && v>=0);
        if(importColumns.slice(0,5).some(k=>!Number.isInteger(mapping[k]) || mapping[k]<0))throw new Error('Asigna las cinco columnas obligatorias.');
        if(new Set(selected).size!==selected.length)throw new Error('Cada campo debe usar una columna diferente.');
        const groups=new Map(),seen=new Set();
        String(text).split(/\r?\n/).forEach((line,index)=>{
            if(!line.trim())return;
            const cells=line.split('\t'),row={};
            importColumns.forEach(k=>row[k]=mapping[k]>=0?(cells[mapping[k]] || '').trim():'');
            const fail=message=>{throw new Error(`Fila ${index+1}: ${message}`);};
            if(!row.unidad || !row.activo || !row.nombre)fail('completa ubicación, activo y componente.');
            row.ubicacion_tecnica=ut(row.ubicacion_tecnica);
            if(!/^\d{4}-[A-Z0-9-]+$/.test(row.ubicacion_tecnica))fail('revisa la ubicación técnica.');
            if(!/^(SI|NO)$/.test(norm(row.disponible)))fail('la disponibilidad debe ser Sí o No.');
            if(row.ot && !/^[A-Z0-9-]+$/i.test(row.ot))fail('revisa la OT.');
            if(seen.has(row.ubicacion_tecnica))fail('ubicación técnica repetida.');
            seen.add(row.ubicacion_tecnica);row.disponible=norm(row.disponible)==='SI';
            const key=JSON.stringify([norm(row.unidad),norm(row.activo),norm(row.ot)]);
            if(!groups.has(key))groups.set(key,{nombre:row.activo,unidad:row.unidad,ot:row.ot,componentes:[]});
            groups.get(key).componentes.push(row);
        });
        if(!groups.size)throw new Error('Agrega al menos una fila de equipos.');
        return [...groups.values()];
    }
    function parsePages(pages, options = {}) {
        let centers, hasOt = false;
        const rows = [], seen = new Set();
        for (const page of pages) {
            const items = page.items.filter(i => i.str?.trim()).map(i => ({s:i.str.trim(),x:(i.transform[4] + (i.width || 0) / 2) / page.width,y:i.transform[5]}));
            if (!items.length) continue;
            // PDF exporters can put the whole heading in one text item or split it
            // over several lines. Identify columns by their leading label instead.
            const firstCodeY = Math.max(-Infinity,...items.filter(i=>/^\d{4}-/.test(i.s)).map(i=>i.y));
            const headings = items.filter(i=>i.y>firstCodeY);
            const header = headings.filter(i=>/^(UBICACION\b|ACTIVO\b|COMPONENTE\b|CRITICIDAD\b|DISPONIBILIDAD\b|OBSERVACIONES\b)/.test(norm(i.s))).sort((a,b)=>a.x-b.x);
            const locations=header.filter(i=>/^UBICACION\b/.test(norm(i.s)));
            const find=label=>header.find(i=>norm(i.s).startsWith(label));
            const columns=[locations[0],find('ACTIVO'),find('COMPONENTE'),locations[1],find('CRITICIDAD'),find('DISPONIBILIDAD'),find('OBSERVACIONES')];
            if (locations.length===2 && [0,1,2,3,5].every(i=>columns[i])) {
                const otHeader = headings.find(i=>/^(ORDEN\b|O\.?\s*T\.?(?:\s|$))/.test(norm(i.s)) && i.x<locations[0].x);
                hasOt = !!otHeader;
                centers = [...(otHeader?[otHeader.x]:[]),...columns.map(i=>i?.x ?? Infinity)];
            }
            if (!centers) throw new Error('No se reconoce la tabla de entrega. Usa el PDF con ubicación, activo, componente, ubicación técnica y disponibilidad.');
            const col = item => centers.reduce((best,c,i)=>Math.abs(c-item.x)<Math.abs(centers[best]-item.x)?i:best,0);
            const offset=hasOt?1:0;
            const anchors = items.filter(i=>col(i)===3+offset && /^\d{4}-/.test(i.s)).sort((a,b)=>b.y-a.y);
            if (!anchors.length) throw new Error('No se encontraron ubicaciones técnicas legibles en esta página. Revisa el PDF antes de importarlo.');
            // Compact tables can put the first row within 28 points of the header.
            // Bound it by the lowest header line instead of including "TRABAJO" as an OT.
            const headerLines = items.filter(i => i.y > anchors[0]?.y && /^(ORDEN\b|O\.?\s*T\.?(?:\s|$)|TRABAJO\b|UBICACION\b|ACTIVO\b|COMPONENTE\b|TECNICA\b|CRITICIDAD\b|DISPONIBILIDAD\b|ENTREGA\b|OBSERVACIONES\b|OPERACIONES\b)/.test(norm(i.s)));
            const headerBottom = headerLines.length ? Math.min(...headerLines.map(i=>i.y)) : Infinity;
            anchors.forEach((anchor,index)=>{
                const top = index ? (anchors[index-1].y+anchor.y)/2 : Math.min(anchor.y+28, headerBottom);
                const bottom = index<anchors.length-1 ? (anchors[index+1].y+anchor.y)/2 : anchor.y-28;
                const cells = Array.from({length:centers.length},()=>[]);
                items.filter(i=>i.y<top && i.y>bottom).sort((a,b)=>Math.abs(a.y-b.y)<2?a.x-b.x:b.y-a.y).forEach(i=>cells[col(i)].push(i.s));
                const values=cells.map(c=>c.join(' ').replace(/\s+/g,' ').trim());
                const ot=hasOt?values.shift():'';
                if(ot && !/^[A-Z0-9-]+$/i.test(ot))throw new Error('No se pudo leer una OT. Revisa la columna Orden de trabajo.');
                const code=ut(values[3]);
                if (!/^\d{4}-[A-Z0-9-]+$/.test(code) || !values[0] || !values[1] || !values[2]) throw new Error('Una fila no pudo leerse completa. No se importó ningún equipo.');
                const status=norm(values[5]);
                if(!status && typeof options.blankAvailability!=='boolean' && options.blankAvailability!=='pending') {
                    const error=new Error('Hay filas con ubicación técnica, pero su disponibilidad está vacía. Indica cómo importarlas.');
                    error.code='BLANK_AVAILABILITY';throw error;
                }
                if(status && !/^(SI|NO)$/.test(status))throw new Error(`Disponibilidad no reconocida para ${code}: ${values[5]}. Debe ser Sí o No.`);
                if (seen.has(code)) throw new Error(`Ubicación técnica repetida en el archivo: ${code}. Revisa el documento.`);
                seen.add(code);
                rows.push({ot,unidad:values[0],activo:values[1],nombre:values[2],ubicacion_tecnica:code,disponible:status?status==='SI':options.blankAvailability===true,disponibilidadPendiente:!status && options.blankAvailability==='pending',observacionOperaciones:values[6]});
            });
        }
        if (!rows.length) throw new Error('El PDF no contiene texto de equipos legible. Los documentos escaneados necesitan reconocimiento de texto.');
        const groups = new Map();
        rows.forEach(row=>{
            const key=norm(row.unidad)+'|'+norm(row.activo)+'|'+norm(row.ot);
            if (!groups.has(key)) groups.set(key,{nombre:row.activo,unidad:row.unidad,ot:row.ot,componentes:[]});
            groups.get(key).componentes.push(row);
        });
        return [...groups.values()];
    }
    function mergeImport(existing, incoming) {
        const equipment=clone(existing);let added=0,updated=0;
        const known=new Map();equipment.forEach(eq=>eq.componentes.forEach(c=>known.set(ut(c.ubicacion_tecnica),eq)));
        for(const eq of incoming){
            const matches=new Set(eq.componentes.map(c=>known.get(ut(c.ubicacion_tecnica))).filter(Boolean));
            for(const old of matches){
                if(!eq.ot)continue;
                if(old.ot && norm(old.ot)!==norm(eq.ot))throw new Error(`OT diferente para ${old.nombre}: guardada ${old.ot}, PDF ${eq.ot}. Revísala con Editar OT antes de importar.`);
                if(!old.ot){old.ot=eq.ot;updated++;}
            }
            const fresh=eq.componentes.filter(c=>!known.has(ut(c.ubicacion_tecnica)));
            if(fresh.length){const next={...clone(eq),componentes:clone(fresh)};equipment.push(next);added+=fresh.length;fresh.forEach(c=>known.set(ut(c.ubicacion_tecnica),next));}
        }
        return {equipment,added,updated};
    }
    function candidates(equipment, routes) {
        const codes=equipment.componentes.map(c=>ut(c.ubicacion_tecnica));
        return routes.filter(route=>codes.every(code=>(route.equipos||[]).some(eq=>(eq.componentes||[]).some(c=>ut(c.ubicacion_tecnica)===code))));
    }
    function mapping(eq, route) {
        return eq.componentes.map(comp=>{
            const matches=[];
            (route?.equipos||[]).forEach((e,ei)=>(e.componentes||[]).forEach((c,ci)=>{if(ut(c.ubicacion_tecnica)===ut(comp.ubicacion_tecnica))matches.push(`${ei}.${ci}`);}));
            if(matches.length!==1) throw new Error(`No hay una coincidencia única para ${comp.ubicacion_tecnica} en esa ruta.`);
            return matches[0];
        });
    }
    function links(ej) {
        if(Number(ej?.rutaIdx)!==-2) return [];
        return (ej.requerimientoEquipos || ej.componentesEstado?.__requerimientoEquipos || []).flatMap((eq,ei)=>(eq.enlace?.componentKeys || []).map((key,ci)=>({id:eq.enlace.ejecucionId,from:`${ei}.${ci}`,to:key,available:eq.componentes[ci]?.disponible!==false})));
    }
    function copyField(target, field, key, value) {
        target[field] ||= {};
        if(value===undefined) delete target[field][key]; else target[field][key]=clone(value);
    }
    function hydrate(ej, get) {
        if(!ej || Number(ej.rutaIdx)!==-2) return ej;
        const result=clone(ej);
        links(ej).filter(l=>l.available).forEach(l=>{
            const source=get(l.id); if(!source)return;
            fields.forEach(f=>copyField(result,f,l.from,source[f]?.[l.to]));
        });
        Object.defineProperty(result, '__dailyBaseline', { value:Object.fromEntries(fields.map(f=>[f,clone(result[f])])), enumerable:false });
        return result;
    }
    // Only edited fields are forwarded, so an unrelated daily edit cannot erase a newer source measurement.
    function changes(ej, previous, get) {
        const updates=new Map();
        links(ej).filter(l=>l.available).forEach(l=>{
            const source=get(l.id); if(!source) return;
            fields.forEach(f=>{
                if(JSON.stringify(ej[f]?.[l.from])===JSON.stringify(previous?.[f]?.[l.from]))return;
                if(!updates.has(l.id))updates.set(l.id,clone(source));
                copyField(updates.get(l.id),f,l.to,ej[f]?.[l.from]);
            });
        });
        return [...updates.values()];
    }
    return {norm,ut,parsePages,recoveryText,parseRecovery,importColumns,mergeImport,candidates,mapping,links,hydrate,changes,fields,copyField};
});
