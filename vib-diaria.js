(() => {
    'use strict';
    const PLAN = -2, EXTRA = -3;
    let mode = '', date = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const definitions = {
        [PLAN]: {nombre:'Planificación diaria',unidad:'DIARIA',frecuencia:'DIARIA',plan:'',equipos:[],esRequerimientos:true},
        [EXTRA]: {nombre:'Trabajos adicionales',unidad:'EXTRA',frecuencia:'REQ',plan:'',equipos:[],esRequerimientos:true}
    };
    function title(e) {
        const daily = e.componentesEstado?.__vibDiaria || {};
        const day = daily.fecha || e.fechaInicio;
        return Number(e.rutaIdx) === PLAN
            ? (daily.nombre || `Plan ${formatearFechaCortaDia(day)}${e.ot ? ` · OT ${e.ot}` : ''}`)
            : `OT ${e.ot || 'Sin asignar'}`;
    }
    function render() {
        const extra = getEjecucionesDeRuta(EXTRA), plans = getEjecucionesDeRuta(PLAN);
        const idx = mode === 'plan' ? PLAN : EXTRA;
        const shown = (mode === 'plan' ? plans : extra).filter(e => mode !== 'plan' || (e.componentesEstado?.__vibDiaria?.fecha || e.fechaInicio) === date);
        mainContent.innerHTML = `<div class="vib-daily fade-in"><button type="button" class="btn btn-outline" id="vib-daily-back">← ${mode ? 'VIB diaria' : 'Vibraciones'}</button><header class="vib-daily-header"><span class="vib-daily-eyebrow">Programa predictivo</span><h1>${mode ? definitions[idx].nombre : 'VIB diaria'}</h1><p>${mode === 'plan' ? 'Organiza los equipos de cada jornada y registra su avance.' : mode === 'extra' ? 'Equipos fuera de las rutas habituales, organizados por orden de trabajo.' : 'Planifica las mediciones del día y atiende trabajos adicionales.'}</p></header>
        ${!mode ? `<div class="vib-daily-options"><button type="button" class="panel vib-daily-option" id="vib-daily-extra"><i class="fa-solid fa-clipboard-list" aria-hidden="true"></i><h2>Trabajos adicionales</h2><p>Abre una OT y agrega los equipos extra que necesitan medición.</p><span>${extra.length} OT abiertas <b aria-hidden="true">→</b></span></button><button type="button" class="panel vib-daily-option" id="vib-daily-plan"><i class="fa-regular fa-calendar-check" aria-hidden="true"></i><h2>Planificación diaria</h2><p>Selecciona una fecha, asigna técnicos y define los equipos de la jornada.</p><span>${plans.length} planes abiertos <b aria-hidden="true">→</b></span></button></div>` : `<section class="panel vib-daily-toolbar">${mode === 'plan' ? `<label for="vib-daily-date">Jornada<input id="vib-daily-date" class="form-control" type="date" value="${escapeHtml(date)}"></label>` : '<span>Una ejecución independiente por OT</span>'}${mode === 'plan' && esRolGestion() ? `<button class="btn btn-outline" type="button" id="vib-daily-import">Importar entrega PDF</button>` : ''}${esRolGestion() ? `<button class="btn btn-primary" type="button" id="vib-daily-new"><i class="fa-solid fa-plus" aria-hidden="true"></i> ${mode === 'plan' ? 'Nueva planificación' : 'Nueva OT'}</button>` : ''}</section><div class="vib-daily-options">${shown.map(e => {
            const stats = rutasContarComponentes(idx,e);
            return `<button class="panel vib-daily-option" type="button" data-daily-open="${e.id}"><span class="vib-daily-eyebrow">${e._dirty ? 'Sincronización pendiente' : 'En curso'}</span><h2>${escapeHtml(title(e))}</h2><p>${escapeHtml((e.tecnicosNombres?.length ? e.tecnicosNombres : [e.liderNombre,e.ayudanteNombre]).filter(Boolean).join(', '))}</p><strong>${stats.listos} / ${stats.total} componentes medidos</strong><progress value="${stats.listos}" max="${stats.total || 1}" aria-label="Avance de mediciones"></progress><span>Continuar trabajo <b aria-hidden="true">→</b></span></button>`;
        }).join('')}</div>${!shown.length ? `<section class="panel vib-daily-empty"><i class="fa-solid fa-list-check" aria-hidden="true"></i><h2>${mode === 'plan' ? 'Sin planificación para esta fecha' : 'Sin trabajos adicionales abiertos'}</h2><p>${mode === 'plan' ? 'Crea un plan y agrega los equipos que deben medirse ese día.' : 'Crea una OT para comenzar a registrar equipos extra.'}</p></section>` : ''}`}</div>`;
        document.getElementById('vib-daily-back').onclick = () => { if (mode) {mode='';render();} else window.vibracionesVolver(); };
        document.getElementById('vib-daily-extra')?.addEventListener('click',()=>{mode='extra';render();});
        document.getElementById('vib-daily-plan')?.addEventListener('click',()=>{mode='plan';render();});
        document.getElementById('vib-daily-date')?.addEventListener('change',event=>{if(event.target.value)date=event.target.value;render();});
        document.getElementById('vib-daily-import')?.addEventListener('click',()=>window.VibDailyImport.importPdf());
        document.getElementById('vib-daily-new')?.addEventListener('click',()=>window.rutasIniciarEjecucion(idx,{fecha:date}));
        mainContent.querySelectorAll('[data-daily-open]').forEach(button=>button.addEventListener('click',()=>window.rutasAbrirDetalle(idx,button.dataset.dailyOpen)));
    }
    window.PlanifyVibDiaria = {is:idx=>[PLAN,EXTRA].includes(Number(idx)),isPlan:idx=>Number(idx)===PLAN,definition:idx=>definitions[Number(idx)],title,render,
        open(idx) {mode=Number(idx)===PLAN?'plan':'extra';},reset(){mode='';},date:()=>date};
})();
