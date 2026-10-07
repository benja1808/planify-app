/* Localhost interface backed by private Supabase storage. */
(() => {
    'use strict';
    const LIMIT = 1_000_000_000;
    const CATEGORIES = ['Mantenimiento', 'END', 'Ultrasonido'];
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const unitOf = value => { const match = String(value || '').match(/^(?:u(?:nidad)?\s*)?([1-5])$/i); return match ? `U${match[1]}` : ''; };
    const mb = bytes => `${(bytes / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 2 })} MB`;
    let host, catalog = [], unit = '', equipmentId = '', adding = false, filter = '', generation = 0;
    let urls = [];
    const cloud = window.MaintenanceCloud;
    let currentUser = null;
    function stateMarkup(kind = 'login') {
        const states = {
            login: ['fa-lock', 'Acceso a fotografías', 'Activa tu acceso a Mantenimiento', 'Ingresa nuevamente con tu PIN de Planify para consultar y registrar fotografías de los equipos.'],
            connection: ['fa-cloud-arrow-up', 'Conexión no disponible', 'No pudimos cargar Mantenimiento', 'No se pudo conectar con el servicio. Comprueba tu conexión y vuelve a intentarlo.'],
            permission: ['fa-shield-halved', 'Acceso restringido', 'No tienes acceso a estos registros', 'Tu sesión no tiene autorización para consultar Mantenimiento. Contacta al administrador para revisar el acceso.'],
            loading: ['fa-spinner fa-spin', 'Preparando tu espacio', 'Cargando Mantenimiento', 'Estamos consultando las unidades, los equipos y sus registros.']
        };
        const [icon, label, title, description] = states[kind];
        host.innerHTML = `<section class="maint fade-in"><header class="maint-intro"><div><span class="maint-eyebrow">Gestión de intervenciones</span><h1>Mantenimiento</h1><p>Trabajos y evidencia fotográfica, organizados por unidad y equipo.</p></div><span class="maint-badge"><i class="fa-solid fa-lock" aria-hidden="true"></i> Fotografías privadas</span></header><div class="maint-state" role="status" aria-live="polite"><div class="maint-state-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></div><span class="maint-eyebrow">${label}</span><h2>${title}</h2><p>${description}</p><div class="maint-actions">${kind === 'loading' ? '' : kind === 'login' ? '<button type="button" class="btn btn-primary" id="maint-relogin">Ingresar con mi PIN <span aria-hidden="true">→</span></button>' : '<button type="button" class="btn btn-primary" id="maint-retry">Volver a intentar</button>'}${kind !== 'loading' ? '<button type="button" class="btn btn-outline" id="maint-exit">Volver al planificador</button>' : ''}</div></div><div id="maint-error" class="maint-error" role="alert"></div><div class="maint-context"><span><i class="fa-solid fa-industry" aria-hidden="true"></i> 5 unidades</span><span><i class="fa-regular fa-images" aria-hidden="true"></i> Evidencia fotográfica</span><span><i class="fa-solid fa-folder-open" aria-hidden="true"></i> Historial de trabajos</span></div></section>`;
        on('maint-relogin', 'click', () => window.cerrarSesionPlanify());
        on('maint-retry', 'click', () => paint());
        on('maint-exit', 'click', () => { generation++; document.getElementById('nav-control')?.click(); });
    }
    function loginMarkup() { stateMarkup('login'); }
    function notice(error) {
        const node = host.querySelector('#maint-error');
        if (node) node.textContent = /failed to fetch|network|fetch failed/i.test(error.message || '') ? 'No se pudo conectar. Comprueba tu conexión y vuelve a intentarlo.' : error.message || String(error);
    }
    function on(id, event, action) {
        host.querySelector(`#${id}`)?.addEventListener(event, async e => {
            try { await action(e); } catch (error) { notice(error); }
        });
    }
    function download(blob, name) {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function paint() {
        const version = ++generation;
        stateMarkup('loading');
        const active = () => version === generation && document.body.dataset.view === 'mantenimiento';
        try { currentUser = await cloud.session(); } catch(error) { if (active()) stateMarkup('connection'); return; }
        if (!active()) return;
        if (!currentUser) { loginMarkup(); return; }
        let loaded;
        try { loaded = await cloud.load(equipmentId); }
        catch(error) {
            if (active()) stateMarkup(error.code === '42501' ? 'permission' : error.status === 401 ? 'login' : 'connection');
            return;
        }
        const {equipment,jobs,usage} = loaded;
        if (version !== generation || document.body.dataset.view !== 'mantenimiento') return;
        urls.forEach(URL.revokeObjectURL); urls = [];
        const current = equipment.find(e => e.id === equipmentId);
        const used = Number(usage.used);
        host.innerHTML = `<section class="maint fade-in">
            <div class="maint-breadcrumb"><button type="button" class="btn btn-outline" id="maint-back">← ${current ? `Volver a Unidad ${unit.slice(1)}` : adding ? 'Volver a los equipos' : unit ? 'Volver a las unidades' : 'Volver al planificador'}</button><button class="btn btn-outline" id="maint-home">Mantenimiento</button>${unit ? `<span>/</span><button class="btn btn-outline" id="maint-unit">${esc(unit)}</button>` : ''}${current ? `<span>/ ${esc(current.name)}</span>` : ''}</div>
            <header class="maint-intro"><div><span class="maint-eyebrow">Gestión de intervenciones</span><h1>${current ? esc(current.name) : unit ? `Unidad ${unit.slice(1)}` : 'Mantenimiento'}</h1><p>${current ? 'Fotografías y trabajos realizados en este equipo.' : unit ? 'Selecciona un equipo para registrar sus trabajos.' : 'Selecciona una de las cinco unidades para comenzar.'}</p></div>${unit && !current ? '<button class="btn btn-primary" id="maint-add">＋ Agregar equipo</button>' : ''}</header>
            <div id="maint-error" class="maint-error" role="alert"></div>
            <div class="maint-summary"><div><span>Equipos${unit ? ' en la unidad' : ' incorporados'}</span><strong>${equipment.filter(e => !unit || e.unit === unit).length}</strong></div><div><span>Registros${current ? ' del equipo' : ''}</span><strong>${jobs.filter(j => current ? j.equipmentId === current.id : !unit || equipment.some(e => e.id === j.equipmentId && e.unit === unit)).length}</strong></div><div><span>Almacenamiento utilizado</span><strong>${mb(used)} <small>/ 1 GB</small></strong></div></div>
            ${!unit ? `<div class="maint-grid">${[1,2,3,4,5].map(n => `<button class="maint-card" data-unit="U${n}"><i class="maint-icon fa-solid fa-industry"></i><strong>Unidad ${n}</strong><small>${equipment.filter(e => e.unit === `U${n}`).length} equipos incorporados</small><span class="maint-card-link">Ver equipos <span aria-hidden="true">→</span></span></button>`).join('')}</div>` : ''}
            ${unit && !current ? `${adding ? addMarkup() : ''}<div class="maint-grid">${equipment.filter(e => e.unit === unit).map(e => `<button class="maint-card" data-equipment="${esc(e.id)}"><i class="maint-icon fa-solid fa-gears"></i><strong>${esc(e.name)}</strong><small>${jobs.filter(j => j.equipmentId === e.id).length} registros · ${esc(e.unit)}</small><span class="maint-card-link">Ver trabajos <span aria-hidden="true">→</span></span></button>`).join('')}</div>${equipment.some(e => e.unit === unit) ? '' : '<div class="maint-empty"><h2>Aún no hay equipos incorporados</h2><p>Agrega solo los equipos que participarán en esta etapa.</p></div>'}` : ''}
            ${current ? detailMarkup(current, jobs, used) : ''}
        </section>`;
        on('maint-signout','click',async () => { await cloud.signOut(); loginMarkup(); });
        on('maint-back', 'click', () => {
            if (equipmentId) { equipmentId = ''; filter = ''; }
            else if (adding) { adding = false; }
            else if (unit) { unit = ''; }
            else { generation++; document.getElementById('nav-control')?.click(); return; }
            return paint();
        });
        on('maint-home', 'click', () => { unit = ''; equipmentId = ''; adding = false; return paint(); });
        on('maint-unit', 'click', () => { equipmentId = ''; adding = false; return paint(); });
        on('maint-add', 'click', () => { adding = !adding; return paint(); });
        host.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => { unit = b.dataset.unit; paint().catch(notice); });
        host.querySelectorAll('[data-equipment]').forEach(b => b.onclick = () => { equipmentId = b.dataset.equipment; filter = ''; paint().catch(notice); });
        if (adding && !current) bindAdd(equipment);
        if (current) bindDetail(current, jobs);
    }
    function addMarkup() {
        return `<section class="maint-panel"><h2>Agregar equipo a ${esc(unit)}</h2><label for="maint-search">Buscar equipo existente por nombre o KKS</label><input id="maint-search" type="search" placeholder="Escribe el nombre del equipo"><div id="maint-results" class="maint-results"></div><details><summary style="margin-top:18px;cursor:pointer">¿No existe? Crear equipo</summary><form id="maint-create"><label for="maint-name">Nombre</label><input id="maint-name" required maxlength="160"><label for="maint-new-unit">Unidad</label><select id="maint-new-unit">${[1,2,3,4,5].map(n => `<option ${unit === `U${n}` ? 'selected' : ''}>U${n}</option>`).join('')}</select><div class="maint-actions"><button class="btn btn-primary">Crear equipo</button></div></form></details></section>`;
    }
    function bindAdd(equipment) {
        async function incorporate(item) {
            const existing = equipment.find(e => (item.sourceId && e.sourceId === item.sourceId) || (e.unit === item.unit && norm(e.name) === norm(item.name)));
            let entry = existing || { ...item, id: crypto.randomUUID() };
            if (!existing) entry = await cloud.addEquipment(entry);
            equipmentId = entry.id; unit = entry.unit; adding = false; filter = ''; await paint();
        }
        const results = () => {
            const query = norm(host.querySelector('#maint-search').value);
            const matches = catalog.filter(e => e.unit === unit && norm(`${e.name} ${e.kks}`).includes(query));
            const target = host.querySelector('#maint-results');
            target.innerHTML = matches.length ? matches.slice(0, 60).map((e, i) => `<button class="maint-result" data-result="${i}"><strong>${esc(e.name)}</strong><br><small>${esc(e.unit)} ${esc(e.kks)}</small></button>`).join('') : '<p>No se encontraron equipos en esta unidad. Puedes crear uno abajo.</p>';
            target.querySelectorAll('[data-result]').forEach(b => b.onclick = () => incorporate(matches[Number(b.dataset.result)]).catch(notice));
        };
        on('maint-search', 'input', results); results();
        on('maint-create', 'submit', async e => {
            e.preventDefault();
            const name = host.querySelector('#maint-name').value.trim(), targetUnit = host.querySelector('#maint-new-unit').value;
            if (!name) throw new Error('Ingresa el nombre del equipo.');
            const match = catalog.find(item => item.unit === targetUnit && norm(item.name) === norm(name));
            await incorporate(match || { name, unit: targetUnit, sourceId: null, kks: '' });
        });
    }
    function detailMarkup(current, jobs, used) {
        const records = jobs.filter(j => j.equipmentId === current.id && (!filter || j.category === filter)).sort((a,b) => b.date.localeCompare(a.date));
        return `<section class="maint-panel"><div class="maint-row"><strong>Almacenamiento Nube</strong><span>${mb(used)} de 1 GB · ${(used / LIMIT * 100).toFixed(1)} %</span></div><progress aria-label="Almacenamiento utilizado en la nube" value="${used}" max="${LIMIT}"></progress><p>${mb(Math.max(0, LIMIT-used))} disponibles. Capacidad total: 1 GB.</p>
        <h2 class="maint-form-title">Registrar una intervención</h2><p>Describe el trabajo y adjunta las fotografías del equipo.</p><form id="maint-job"><label for="maint-category">Categoría</label><select id="maint-category">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select><label for="maint-title">¿De qué son las imágenes?</label><input id="maint-title" required maxlength="180" placeholder="Ej.: Inspección del sello mecánico"><label for="maint-work">Trabajos realizados</label><textarea id="maint-work" required maxlength="10000" placeholder="Describe la intervención y los hallazgos"></textarea><label for="maint-files">Fotografías</label><input id="maint-files" type="file" accept="image/jpeg,image/png,image/webp" multiple required><p id="maint-selected" aria-live="polite">Selecciona una o más fotografías JPG, PNG o WebP.</p><div class="maint-actions"><button class="btn btn-primary" id="maint-save">Guardar en la nube</button></div></form></section>
        <div class="maint-row"><h2>Registros del equipo</h2><select id="maint-filter" aria-label="Filtrar registros" style="width:auto"><option value="">Todas las categorías</option>${CATEGORIES.map(c => `<option ${c === filter ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        ${records.length ? records.map(j => `<article class="maint-panel"><div class="maint-row"><h2>${esc(j.title)}</h2><small>${esc(j.category)} · ${new Date(j.date).toLocaleDateString('es-CL')}</small></div><p style="white-space:pre-wrap">${esc(j.work)}</p><p>${j.status !== 'ready' ? 'Carga incompleta o eliminación pendiente. Elimina este registro para liberar espacio.' : ''}</p><div class="maint-photos">${(j.status === 'ready' ? j.photos : []).map(p => { const url = p.url || '';  return `<figure><img src="${esc(url)}" alt="${esc(p.name)}" loading="lazy"><figcaption>${esc(p.name)}</figcaption></figure>`; }).join('')}</div><div class="maint-actions"><button class="btn btn-outline" data-zip="${j.id}" ${j.status !== 'ready' ? 'disabled' : ''}>Descargar carpeta ZIP</button><button class="btn maint-danger" data-delete="${j.id}">Eliminar de la nube</button></div></article>`).join('') : '<div class="maint-empty"><i class="fa-regular fa-images maint-icon" aria-hidden="true"></i><h2>No hay registros para esta selección</h2><p>Registra una intervención o selecciona otra categoría para consultar los trabajos.</p></div>'}`;
    }
    function bindDetail(current, jobs) {
        on('maint-filter', 'change', e => { filter = e.target.value; return paint(); });
        on('maint-files', 'change', e => {
            const files = [...e.target.files], size = files.reduce((n,f) => n+f.size,0);
            host.querySelector('#maint-selected').textContent = `${files.length} fotografías seleccionadas · ${mb(size)}`;
        });
        on('maint-job', 'submit', async e => {
            e.preventDefault();
            const button = host.querySelector('#maint-save'); button.disabled = true;
            try {
                const files = [...host.querySelector('#maint-files').files];
                const title = host.querySelector('#maint-title').value.trim(), work = host.querySelector('#maint-work').value.trim();
                if (!title || !work || !files.length) throw new Error('Completa la descripción, los trabajos y las fotografías.');
                if (files.some(f => !['image/jpeg','image/png','image/webp'].includes(f.type))) throw new Error('Solo se permiten fotografías JPG, PNG o WebP.');
                if (files.length > 100 || files.some(f => f.size > 20*1024*1024 || f.size === 0)) throw new Error('Selecciona hasta 100 fotos de máximo 20 MB cada una.');
                const job = { id: crypto.randomUUID(), equipmentId: current.id, category: host.querySelector('#maint-category').value, title, work, date: new Date().toISOString(), photos: files.map(f => ({name:f.name,blob:f})) };
                await cloud.saveJob(job, message => { button.textContent = message; });
                await paint();
            } finally { button.disabled = false; button.textContent = 'Guardar en la nube'; }
        });
        host.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
            if (!confirm('¿Eliminar este registro y sus fotografías de la nube? Comprueba primero que el ZIP descargado esté completo. Esta acción no se puede deshacer.')) return;
            try { b.disabled = true; await cloud.deleteJob(jobs.find(j => j.id === b.dataset.delete)); await paint(); } catch(error) { b.disabled = false; notice(error); }
        });
        host.querySelectorAll('[data-zip]').forEach(b => b.onclick = async () => {
            b.disabled = true;
            try {
                if (!window.PizZip) throw new Error('No está disponible el generador ZIP. Recarga con conexión a internet.');
                const job = jobs.find(j => j.id === b.dataset.zip), zip = new window.PizZip();
                const safe = value => String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').trim() || 'registro';
                const archiveName = [safe(current.unit).slice(0,2), safe(current.name).slice(0,30), safe(job.category).slice(0,13), safe(job.date.slice(0,10))].join(' - ');
                const photoNames = job.photos.map((p,i) => {
                    const extension = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[p.mime] || /\.(jpe?g|png|webp)$/i.exec(p.name)?.[1].toLowerCase() || 'jpg';
                    return `foto-${String(i+1).padStart(3,'0')}.${extension}`;
                });
                zip.file('trabajos-realizados.txt', `Equipo: ${current.name}\nUnidad: ${current.unit}\nCategoría: ${job.category}\nFecha: ${job.date}\nDescripción: ${job.title}\n\nTrabajos realizados:\n${job.work}\n\nFotografías (nombre original):\n${job.photos.map((p,i) => `${photoNames[i]}: ${p.name}`).join('\n')}\n`);
                for (const [i,p] of job.photos.entries()) zip.file(photoNames[i], await (await cloud.photoBlob(p)).arrayBuffer());
                download(zip.generate({type:'blob',compression:'STORE'}), `${archiveName}.zip`);
            } catch(error) { notice(error); } finally { b.disabled = false; }
        });
    }
    window.PlanifyMantenimiento = {
        render(target, equipment) {
            if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) return;
            host = target;
            const seen = new Set();
            catalog = (equipment || []).map(e => ({sourceId: String(e.id), name: e.activo || e.nombre || '', unit: unitOf(e.unidad || e.ubicacion), kks:e.kks || ''})).filter(e => {
                const key = `${e.unit}|${norm(e.name)}`;
                if (!e.unit || !e.name || seen.has(key)) return false;
                seen.add(key); return true;
            });
            host.innerHTML = '<section class="maint"><p>Cargando mantenimiento…</p><div id="maint-error" role="alert"></div></section>';
            paint().catch(notice);
        }
    };
})();
