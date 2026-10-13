(() => {
    'use strict';
    const core = window.VibDailyCore;
    const esc = value => escapeHtml(String(value ?? ''));
    const routes = () => catalogoRutasVibracion().filter(r=>r.idx>=0);
    function modal(title, body) {
        document.getElementById('vib-daily-dialog')?.remove();
        const overlay=document.createElement('div');
        overlay.id='vib-daily-dialog';overlay.className='vib-import-overlay';
        overlay.innerHTML=`<section class="vib-import-dialog" role="dialog" aria-modal="true" aria-labelledby="vib-dialog-title"><header><h2 id="vib-dialog-title">${esc(title)}</h2><button type="button" class="btn btn-outline" data-close aria-label="Cerrar">✕</button></header><div class="vib-import-body">${body}</div></section>`;
        const close=()=>{overlay.dispatchEvent(new Event('vib-close'));overlay.remove();document.removeEventListener('keydown',onKey);};
        const onKey=e=>{
            if(e.key==='Escape')close();
            if(e.key==='Tab'){
                const controls=[...overlay.querySelectorAll('button,input,select,textarea')].filter(el=>!el.disabled && el.getClientRects().length);
                const first=controls[0],last=controls[controls.length-1];
                if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
                else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
            }
        };
        overlay.querySelector('[data-close]').onclick=close;document.addEventListener('keydown',onKey);document.body.appendChild(overlay);
        overlay.querySelector('button').focus();
        return {overlay,close};
    }
    function equipmentHtml(eq) {
        const matches=core.candidates(eq,routes());
        return `<article class="vib-import-equipment"><h3>${esc(eq.nombre)} <small>${esc(eq.unidad)}${eq.ot ? ` · OT ${esc(eq.ot)}` : ' · Sin OT en el archivo'}</small></h3><p class="vib-import-route">${matches.length===1 ? esc(matches[0].nombre) : matches.length ? 'Varias rutas posibles: se resolverá al asignar la OT.' : 'Ruta pendiente de identificar.'}</p><ul>${eq.componentes.map(c=>`<li><div><strong>${esc(c.nombre)}</strong><code>${esc(c.ubicacion_tecnica)}</code>${c.observacionOperaciones?`<p>${esc(c.observacionOperaciones)}</p>`:''}</div><span class="vib-availability ${c.disponible?'':'unavailable'}">${c.disponible?'A medir':'No disponible'}</span></li>`).join('')}</ul></article>`;
    }
    function recoverImport(dialog,pages,error) {
        return new Promise(resolve=>{
            const body=dialog.overlay.querySelector('.vib-import-body');
            const labels=['Ubicación *','Activo *','Componente *','Ubicación técnica *','Disponibilidad *','OT (opcional)','Observaciones (opcional)'];
            body.innerHTML=`<p role="alert">${esc(error.message)}</p><h3>Corregir lectura del PDF</h3><p>Puedes resolverlo aquí: deja solo las filas de equipos, corrige el texto y selecciona qué columna corresponde a cada campo. Las columnas se separan con tabulaciones; también puedes pegar una tabla desde Excel. Conserva todas las filas y observaciones del documento.</p><label>Tabla editable<textarea id="vib-recovery-text" class="form-control" rows="12" wrap="off" style="width:100%;white-space:pre"></textarea></label><p id="vib-recovery-count" role="status"></p><div id="vib-recovery-columns">${core.importColumns.map((key,i)=>`<label>${labels[i]}<select class="form-control" data-field="${key}"></select></label>`).join('')}</div><p id="vib-recovery-error" role="alert"></p><p>Se validarán todas las filas antes de mostrar la vista previa. La planificación aún no se modifica.</p><button type="button" class="btn btn-primary" id="vib-recovery-check">Validar y revisar equipos</button>`;
            const textarea=body.querySelector('textarea');textarea.value=core.recoveryText(pages);
            const selects=[...body.querySelectorAll('[data-field]')];
            function refresh(){
                const rows=textarea.value.split(/\r?\n/).filter(s=>s.trim());
                const count=Math.max(0,...rows.map(s=>s.split('\t').length));
                body.querySelector('#vib-recovery-count').textContent=`${rows.length} filas · ${count} columnas. Elimina títulos y encabezados antes de validar.`;
                selects.forEach(select=>{
                    const previous=select.value;
                    select.innerHTML='<option value="-1">Seleccionar / Sin columna</option>'+Array.from({length:count},(_,i)=>`<option value="${i}">Columna ${i+1}: ${esc((rows[0]?.split('\t')[i] || '').slice(0,60))}</option>`).join('');
                    select.value=previous && Number(previous)<count?previous:'-1';
                });
            }
            textarea.addEventListener('input',refresh);refresh();textarea.focus();
            const cancel=()=>resolve(null);dialog.overlay.addEventListener('vib-close',cancel,{once:true});
            body.querySelector('#vib-recovery-check').onclick=()=>{
                try {
                    const result=core.parseRecovery(textarea.value,Object.fromEntries(selects.map(s=>[s.dataset.field,Number(s.value)])));
                    dialog.overlay.removeEventListener('vib-close',cancel);resolve(result);
                }catch(e){body.querySelector('#vib-recovery-error').textContent=e.message;}
            };
        });
    }
    async function importPdf(targetId=null) {
        if(!esRolGestion())return;
        const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';
        input.onchange=async()=>{
            const file=input.files?.[0];if(!file)return;
            const dialog=modal('Importar entrega de equipos','<p role="status">Leyendo el PDF…</p>');
            try {
                if(file.size>20*1024*1024)throw new Error('El PDF supera los 20 MB. Usa un archivo más pequeño.');
                const pdfjs=await import('./vendor/pdfjs/pdf.js');pdfjs.GlobalWorkerOptions.workerSrc='./vendor/pdfjs/pdf.worker.js';
                const documentPdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true,isEvalSupported:false}).promise;
                const pages=[];
                try {
                    if(documentPdf.numPages>50)throw new Error('La entrega admite hasta 50 páginas.');
                    for(let n=1;n<=documentPdf.numPages;n++){const page=await documentPdf.getPage(n);pages.push({width:page.view[2]-page.view[0],items:(await page.getTextContent()).items});}
                } finally {await documentPdf.destroy();}
                if(!dialog.overlay.isConnected)return;
                let parsed;
                try {parsed=core.parsePages(pages);}
                catch(error){parsed=await recoverImport(dialog,pages,error);}
                if(!parsed || !dialog.overlay.isConnected)return;
                const equipment=parsed.map(eq=>{
                    const matches=core.candidates(eq,routes());
                    return {...eq,id:window.RouteExecutionStore.newId(),rutaSugerida:matches.length===1?matches[0].idx:null,entregaFuente:file.name};
                });
                if(!dialog.overlay.isConnected)return;
                const components=equipment.flatMap(e=>e.componentes),available=components.filter(c=>c.disponible).length;
                const fileDate=/(\d{2})-(\d{2})-(\d{4})/.exec(file.name);
                const target=targetId?getEjecucionActiva(-2,targetId):null;
                const day=target?.componentesEstado?.__vibDiaria?.fecha || (fileDate?`${fileDate[3]}-${fileDate[2]}-${fileDate[1]}`:PlanifyVibDiaria.date());
                dialog.overlay.querySelector('.vib-import-body').innerHTML=`<p>${esc(file.name)}</p><div class="vib-import-summary"><strong>${equipment.length} equipos</strong><span>${available} componentes a medir</span><span>${components.length-available} no disponibles</span></div><label>Fecha de la jornada<input id="vib-import-date" class="form-control" type="date" value="${esc(day)}" ${target?'disabled':''}></label><label>Destino<select id="vib-import-target" class="form-control"></select></label><p>Se conservarán las observaciones de Operaciones. Los componentes ya existentes no se duplicarán. Se completarán las OT que estén vacías; las OT diferentes requerirán revisión.</p><div>${equipment.map(equipmentHtml).join('')}</div><p id="vib-import-error" role="alert"></p><button type="button" class="btn btn-primary" id="vib-import-confirm">Importar planificación</button>`;
                const dateInput=dialog.overlay.querySelector('#vib-import-date');
                const select=dialog.overlay.querySelector('#vib-import-target');
                const destinations=()=>{
                    const plans=getEjecucionesDeRuta(-2).filter(e=>(e.componentesEstado?.__vibDiaria?.fecha || e.fechaInicio)===dateInput.value);
                    select.innerHTML=`<option value="">Crear planificación y asignar técnicos</option>${plans.map(e=>`<option value="${esc(e.id)}">${esc(PlanifyVibDiaria.title(e))}</option>`).join('')}`;
                    if(target) {select.value=target.id;select.disabled=true;} else if(plans.length===1)select.value=plans[0].id;
                };
                dateInput.onchange=destinations;destinations();
                dialog.overlay.querySelector('#vib-import-confirm').onclick=async()=>{
                    const error=dialog.overlay.querySelector('#vib-import-error');error.textContent='';
                    if(!dateInput.value || !dateInput.checkValidity()){error.textContent='Selecciona una fecha válida.';return;}
                    if(!select.value){dialog.close();window.rutasIniciarEjecucion(-2,{fecha:dateInput.value,equipos:equipment,archivo:file.name});return;}
                    const ej=getEjecucionActiva(-2,select.value);
                    if(!ej){error.textContent='La planificación ya no está abierta. Actualiza la vista.';return;}
                    normalizarEjecucionRequerimientos(ej);
                    try {
                        const result=core.mergeImport(ej.requerimientoEquipos,equipment);
                        if(!result.added && !result.updated){error.textContent='Todos los componentes y OT de este archivo ya están en esta planificación.';return;}
                        ej.requerimientoEquipos=result.equipment;
                    }catch(e){error.textContent=e.message;return;}
                    setEjecucionActiva(-2,ej);dialog.close();window.rutasAbrirDetalle(-2,ej.id);
                };
            }catch(error){if(dialog.overlay.isConnected)dialog.overlay.querySelector('.vib-import-body').innerHTML=`<p role="alert">${esc(error.message || 'No se pudo leer el PDF.')}</p><p>No se modificó la planificación.</p>`;}
        };
        input.click();
    }
    function editOt(id,eqIdx) {
        if(!esRolGestion())return;
        const ej=getEjecucionActiva(-2,id);const eq=ej?.requerimientoEquipos?.[eqIdx];if(!eq)return;
        const compatibles=getTodasEjecucionesRutas().filter(e=>e.rutaIdx!==-2 && e.ot && (()=>{try{core.mapping(eq,obtenerRutaVibracion(e.rutaIdx,e));return true;}catch{return false;}})());
        const suggestions=core.candidates(eq,routes());
        const dialog=modal(`OT · ${eq.nombre}`,`<p>${suggestions.length===1?esc(suggestions[0].nombre):'Selecciona una ejecución compatible o registra el número de OT.'}</p><label>Número de OT<input id="vib-eq-ot" class="form-control" maxlength="80" value="${esc(eq.ot || '')}" placeholder="Ej: 12345678"></label><label>Ejecución de ruta<select id="vib-eq-link" class="form-control"><option value="">Solo registrar OT</option>${compatibles.map(e=>`<option value="${esc(e.id)}">OT ${esc(e.ot)} · ${esc(obtenerRutaVibracion(e.rutaIdx,e)?.nombre)}</option>`).join('')}</select></label><p id="vib-eq-hint"></p><p id="vib-eq-error" role="alert"></p><button type="button" class="btn btn-primary" id="vib-eq-save">Guardar OT</button>`);
        const input=dialog.overlay.querySelector('#vib-eq-ot'),select=dialog.overlay.querySelector('#vib-eq-link'),hint=dialog.overlay.querySelector('#vib-eq-hint');
        function match(){const matches=compatibles.filter(e=>core.norm(e.ot)===core.norm(input.value));select.value=matches.length===1?matches[0].id:'';hint.textContent=matches.length===1?'Se enlazará con esta ejecución y compartirá su avance.':matches.length>1?'Hay varias ejecuciones con esa OT. Selecciona la que corresponde.':'La OT quedará registrada sin abrir ninguna ruta.';}
        input.oninput=match;select.onchange=()=>{const source=compatibles.find(e=>e.id===select.value);if(source)input.value=source.ot;hint.textContent=source?'El avance se compartirá con la ejecución seleccionada.':'La OT quedará registrada sin abrir ninguna ruta.';};
        match();if(eq.enlace && compatibles.some(e=>e.id===eq.enlace.ejecucionId))select.value=eq.enlace.ejecucionId;
        dialog.overlay.querySelector('#vib-eq-save').onclick=()=>{
            const error=dialog.overlay.querySelector('#vib-eq-error');
            try {
                const latest=getEjecucionActiva(-2,id);if(!latest)throw new Error('Esta planificación ya no está abierta.');
                const item=latest.requerimientoEquipos[eqIdx];const source=select.value?window.RouteExecutionStore.get(select.value):null;
                if(select.value && !source)throw new Error('La OT seleccionada ya no está abierta. Actualiza la vista.');
                const ot=core.norm(input.value);if(!ot)throw new Error('Ingresa el número de OT.');
                if(source && core.norm(source.ot)!==ot)throw new Error('La OT no coincide con la ejecución seleccionada.');
                if(item.enlace && item.enlace.ejecucionId!==source?.id && item.componentes.some((_,ci)=>latest.mediciones?.[`${eqIdx}.${ci}`]))throw new Error('Este equipo ya comparte mediciones con una ruta. No se puede cambiar el enlace sin revisar esas lecturas.');
                if(source){
                    const keys=core.mapping(item,obtenerRutaVibracion(source.rutaIdx,source));
                    keys.forEach((key,ci)=>{
                        if(item.componentes[ci].disponible===false)return;
                        const local=latest.mediciones?.[`${eqIdx}.${ci}`],remote=source.mediciones?.[key];
                        if(local && JSON.stringify(local)!==JSON.stringify(remote))throw new Error('El equipo ya tiene mediciones propias. Revisa esas lecturas antes de enlazarlo para no reemplazarlas.');
                    });
                    item.enlace={ejecucionId:source.id,rutaIdx:source.rutaIdx,componentKeys:keys};
                    // Source readings win on first link; opening the link never writes source measurements.
                    keys.forEach((key,ci)=>{if(item.componentes[ci].disponible!==false)core.fields.forEach(f=>core.copyField(latest,f,`${eqIdx}.${ci}`,source[f]?.[key]));});
                }else delete item.enlace;
                item.ot=ot;setEjecucionActiva(-2,latest,{skipLinks:true});dialog.close();renderRutasView();
            }catch(e){error.textContent=e.message;}
        };
    }
    function equipmentBadge(ej,eq,eqIdx) {
        if(Number(ej?.rutaIdx)!==-2)return '';
        const linked=eq.enlace && window.RouteExecutionStore.get(eq.enlace.ejecucionId);
        const route=eq.rutaSugerida!=null?routes().find(r=>r.idx===eq.rutaSugerida):null;
        return `<div class="vib-equipment-ot">${route?`<small>${esc(route.nombre)}</small>`:''}<span>${eq.ot?`OT ${esc(eq.ot)} · ${linked?'Enlazada':eq.enlace?'Ruta cerrada o no disponible':'Sin enlazar'}`:'Sin OT asignada'}</span>${esRolGestion()?`<button class="btn btn-outline" type="button" onclick="VibDailyImport.editOt('${esc(ej.id)}',${eqIdx})">${eq.ot?'Editar OT':'+ OT'}</button>`:''}</div>`;
    }
    function unavailable(comp){return `<div class="vib-unavailable"><strong>${esc(comp.nombre)}</strong><code>${esc(comp.ubicacion_tecnica)}</code><span>No disponible · Fuera del pendiente diario</span><p>${esc(comp.observacionOperaciones || 'Sin observaciones de Operaciones.')}</p></div>`;}
    const closedLink = eq => !!eq?.enlace && !window.RouteExecutionStore.get(eq.enlace.ejecucionId);
    function closedComponent(comp,med){return `<div class="vib-unavailable"><strong>${esc(comp.nombre)}</strong><code>${esc(comp.ubicacion_tecnica)}</code><p>La ruta enlazada está cerrada o no está disponible. Se conserva el avance registrado.</p>${med?`<p>Vibración: ${esc(med.vibracion ?? '—')} · Temperatura: ${esc(med.temperatura ?? '—')}</p>`:''}</div>`;}
    window.VibDailyImport={importPdf,editOt,equipmentBadge,unavailable,closedLink,closedComponent};
})();
