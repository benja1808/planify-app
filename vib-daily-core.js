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
    function parsePages(pages) {
        let centers, hasOt = false;
        const rows = [], seen = new Set();
        for (const page of pages) {
            const items = page.items.filter(i => i.str?.trim()).map(i => ({s:i.str.trim(),x:(i.transform[4] + i.width / 2) / page.width,y:i.transform[5]}));
            if (!centers) {
                const labels = ['UBICACION','ACTIVO','COMPONENTE','UBICACION','CRITICIDAD','DISPONIBILIDAD DE','OBSERVACIONES'];
                const header = items.filter(i => labels.includes(norm(i.s))).sort((a,b)=>a.x-b.x);
                if (header.length !== 7) throw new Error('No se reconoce la tabla de entrega. Usa el PDF con ubicación, activo, componente, ubicación técnica y disponibilidad.');
                const otHeader = items.find(i=>/^(ORDEN DE|ORDEN DE TRABAJO|OT)$/.test(norm(i.s)) && i.x<header[0].x);
                hasOt = !!otHeader;
                centers = [...(otHeader?[otHeader.x]:[]),...header.map(i=>i.x)];
            }
            const col = item => centers.reduce((best,c,i)=>Math.abs(c-item.x)<Math.abs(centers[best]-item.x)?i:best,0);
            const offset=hasOt?1:0;
            const anchors = items.filter(i=>col(i)===5+offset && /^(SI|NO)$/.test(norm(i.s))).sort((a,b)=>b.y-a.y);
            const codes = items.filter(i=>col(i)===3+offset && /^\d{4}-/.test(i.s));
            if (codes.length !== anchors.length || (!anchors.length && items.length)) throw new Error('Hay filas sin disponibilidad o sin ubicación técnica. Revisa el PDF antes de importarlo.');
            anchors.forEach((anchor,index)=>{
                const top = index ? (anchors[index-1].y+anchor.y)/2 : anchor.y+28;
                const bottom = index<anchors.length-1 ? (anchors[index+1].y+anchor.y)/2 : anchor.y-28;
                const cells = Array.from({length:centers.length},()=>[]);
                items.filter(i=>i.y<top && i.y>bottom).sort((a,b)=>Math.abs(a.y-b.y)<2?a.x-b.x:b.y-a.y).forEach(i=>cells[col(i)].push(i.s));
                const values=cells.map(c=>c.join(' ').replace(/\s+/g,' ').trim());
                const ot=hasOt?values.shift():'';
                if(ot && !/^[A-Z0-9-]+$/i.test(ot))throw new Error('No se pudo leer una OT. Revisa la columna Orden de trabajo.');
                const code=ut(values[3]);
                if (!/^\d{4}-[A-Z0-9-]+$/.test(code) || !values[0] || !values[1] || !values[2]) throw new Error('Una fila no pudo leerse completa. No se importó ningún equipo.');
                if (seen.has(code)) throw new Error(`Ubicación técnica repetida en el archivo: ${code}. Revisa el documento.`);
                seen.add(code);
                rows.push({ot,unidad:values[0],activo:values[1],nombre:values[2],ubicacion_tecnica:code,disponible:norm(anchor.s)==='SI',observacionOperaciones:values[6]});
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
    return {norm,ut,parsePages,mergeImport,candidates,mapping,links,hydrate,changes,fields,copyField};
});
