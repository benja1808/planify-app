(function() {
    'use strict';

    const DAILY_NEWS_DRAFT_ID = 'planify-informe-novedades-diarias-activo';
    const DAILY_NEWS_STORAGE_KEY = 'planify_informe_novedades_diarias';
    const DAILY_NEWS_MODAL_ID = 'modal-informe-novedades-diarias';
    const DAILY_NEWS_TEMPLATE_URL = 'NOVEDADES%20APPLUS%2016-04-2026.docx';
    const DAILY_NEWS_IMAGE_QUALITY = 0.75;
    const WORD_ACTIVITY_NUM_ID = 127;
    const WORD_IMAGE_MAX_WIDTH_EMU = 14 * 360000;

    let dailyNewsSaveTimer = null;

    function escapeHtmlDailyNews(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function escapeXmlDailyNews(value) {
        return String(value ?? '').replace(/[<>&"']/g, char => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&apos;',
        }[char]));
    }

    function obtenerFechaLocalISO(fecha = new Date()) {
        const year = fecha.getFullYear();
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function normalizarFechaInformeNovedades(valor) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))) return valor;
        return obtenerFechaLocalISO();
    }

    function formatearTituloInformeNovedades(fechaIso) {
        const fecha = new Date(`${normalizarFechaInformeNovedades(fechaIso)}T12:00:00`);
        if (Number.isNaN(fecha.getTime())) return 'Novedades.';
        const weekday = new Intl.DateTimeFormat('es-CL', { weekday: 'long' }).format(fecha).toLowerCase();
        const day = String(fecha.getDate()).padStart(2, '0');
        const month = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(fecha).toLowerCase();
        const year = fecha.getFullYear();
        return `Novedades ${weekday} ${day} de ${month} ${year}.`;
    }

    function crearActividadInformeNovedades(texto = '') {
        return {
            id: crypto.randomUUID(),
            texto: String(texto || ''),
        };
    }

    function crearOtInformeNovedades() {
        return {
            id: crypto.randomUUID(),
            numero: '',
            descripcion: '',
            avance: '',
            finalizado: false,
            contexto: '',
            actividades: [crearActividadInformeNovedades('')],
            observaciones: '',
            fotos: [],
        };
    }

    function crearCategoriaInformeNovedades(nombre = '') {
        return {
            id: crypto.randomUUID(),
            nombre: String(nombre || ''),
            ots: [],
        };
    }

    function crearInformeNovedadesBase() {
        return {
            id: DAILY_NEWS_DRAFT_ID,
            fecha: obtenerFechaLocalISO(),
            categorias: [],
            updated_at: new Date().toISOString(),
        };
    }

    function normalizarFotosInformeNovedades(fotos) {
        if (!Array.isArray(fotos)) return [];
        return fotos
            .filter(Boolean)
            .map(foto => ({
                id: foto.id || crypto.randomUUID(),
                name: String(foto.name || foto.nombre || 'foto.jpeg'),
                dataUrl: String(foto.dataUrl || foto.url || ''),
                width: Number(foto.width || 0) || 0,
                height: Number(foto.height || 0) || 0,
                mimeType: String(foto.mimeType || foto.type || 'image/jpeg'),
                size: Number(foto.size || 0) || 0,
            }))
            .filter(foto => foto.dataUrl.startsWith('data:image/'));
    }

    function normalizarActividadesInformeNovedades(actividades) {
        if (!Array.isArray(actividades) || !actividades.length) {
            return [crearActividadInformeNovedades('')];
        }
        return actividades.map(item => {
            if (typeof item === 'string') return crearActividadInformeNovedades(item);
            return {
                id: item.id || crypto.randomUUID(),
                texto: String(item.texto || item.text || ''),
            };
        });
    }

    function normalizarOtInformeNovedades(ot) {
        const base = crearOtInformeNovedades();
        return {
            ...base,
            ...(ot || {}),
            id: ot?.id || base.id,
            numero: String(ot?.numero || ''),
            descripcion: String(ot?.descripcion || ''),
            avance: String(ot?.avance ?? ''),
            finalizado: Boolean(ot?.finalizado),
            contexto: String(ot?.contexto || ''),
            actividades: normalizarActividadesInformeNovedades(ot?.actividades),
            observaciones: String(ot?.observaciones || ''),
            fotos: normalizarFotosInformeNovedades(ot?.fotos),
        };
    }

    function normalizarCategoriaInformeNovedades(categoria) {
        const base = crearCategoriaInformeNovedades();
        return {
            ...base,
            ...(categoria || {}),
            id: categoria?.id || base.id,
            nombre: String(categoria?.nombre || ''),
            ots: Array.isArray(categoria?.ots) ? categoria.ots.map(normalizarOtInformeNovedades) : [],
        };
    }

    function normalizarInformeNovedadesDiarias(informe) {
        const base = crearInformeNovedadesBase();
        return {
            ...base,
            ...(informe || {}),
            id: DAILY_NEWS_DRAFT_ID,
            fecha: normalizarFechaInformeNovedades(informe?.fecha || base.fecha),
            categorias: Array.isArray(informe?.categorias)
                ? informe.categorias.map(normalizarCategoriaInformeNovedades)
                : base.categorias,
            updated_at: informe?.updated_at || base.updated_at,
        };
    }

    function getInformeNovedadesState() {
        estado.informeNovedadesDiarias = normalizarInformeNovedadesDiarias(estado.informeNovedadesDiarias);
        return estado.informeNovedadesDiarias;
    }

    function setInformeNovedadesState(informe) {
        estado.informeNovedadesDiarias = normalizarInformeNovedadesDiarias(informe);
        return estado.informeNovedadesDiarias;
    }

    async function cargarInformeNovedadesDiarias() {
        let payload = null;

        try {
            payload = await window.localDB?.informes_diarios?.get(DAILY_NEWS_DRAFT_ID);
        } catch (error) {
            console.warn('[Novedades] No se pudo leer el borrador local:', error);
        }

        if (!payload) {
            try {
                const raw = window.localStorage?.getItem(DAILY_NEWS_STORAGE_KEY);
                if (raw) payload = JSON.parse(raw);
            } catch (error) {
                console.warn('[Novedades] No se pudo leer el respaldo localStorage:', error);
            }
        }

        return setInformeNovedadesState(payload || crearInformeNovedadesBase());
    }

    async function persistirInformeNovedadesDiarias() {
        const informe = setInformeNovedadesState({
            ...getInformeNovedadesState(),
            updated_at: new Date().toISOString(),
        });

        try {
            await window.localDB?.informes_diarios?.upsert(informe);
        } catch (error) {
            console.warn('[Novedades] No se pudo guardar en IndexedDB:', error);
        }

        try {
            window.localStorage?.setItem(DAILY_NEWS_STORAGE_KEY, JSON.stringify(informe));
        } catch (error) {
            console.warn('[Novedades] No se pudo guardar respaldo localStorage:', error);
        }

        return informe;
    }

    function programarGuardadoInformeNovedades() {
        clearTimeout(dailyNewsSaveTimer);
        dailyNewsSaveTimer = setTimeout(() => {
            persistirInformeNovedadesDiarias().catch(error => {
                console.warn('[Novedades] No se pudo persistir el borrador:', error);
            });
        }, 240);
    }

    async function flushGuardadoInformeNovedades() {
        if (dailyNewsSaveTimer) {
            clearTimeout(dailyNewsSaveTimer);
            dailyNewsSaveTimer = null;
        }
        return persistirInformeNovedadesDiarias();
    }

    async function asegurarInformeNovedadesCargado() {
        if (!estado.informeNovedadesDiarias) {
            await cargarInformeNovedadesDiarias();
        }
        return getInformeNovedadesState();
    }

    function getConteosInformeNovedades(informe) {
        const categorias = informe.categorias.length;
        const ots = informe.categorias.reduce((acum, categoria) => acum + categoria.ots.length, 0);
        const fotos = informe.categorias.reduce((acum, categoria) =>
            acum + categoria.ots.reduce((sub, ot) => sub + (ot.fotos || []).length, 0), 0);
        return { categorias, ots, fotos };
    }

    function getOtMutable(catIndex, otIndex) {
        const informe = getInformeNovedadesState();
        const categoria = informe.categorias[catIndex];
        if (!categoria) return null;
        return categoria.ots[otIndex] || null;
    }

    function cerrarInformeNovedadesDiariasModal() {
        document.getElementById(DAILY_NEWS_MODAL_ID)?.remove();
        if (window.__planifyDailyNewsEscHandler) {
            document.removeEventListener('keydown', window.__planifyDailyNewsEscHandler);
            window.__planifyDailyNewsEscHandler = null;
        }
    }

    function registrarEscapeInformeNovedades() {
        if (window.__planifyDailyNewsEscHandler) {
            document.removeEventListener('keydown', window.__planifyDailyNewsEscHandler);
        }
        window.__planifyDailyNewsEscHandler = event => {
            if (event.key === 'Escape') cerrarInformeNovedadesDiariasModal();
        };
        document.addEventListener('keydown', window.__planifyDailyNewsEscHandler);
    }

    function renderFotoPreviewHtml(foto, catIndex, otIndex) {
        const descripcion = escapeHtmlDailyNews(foto.name || 'Foto adjunta');
        return `
            <figure class="daily-news-photo-card">
                <img src="${foto.dataUrl}" alt="${descripcion}">
                <figcaption>${descripcion}</figcaption>
                <button type="button" class="daily-news-photo-remove"
                    onclick="window.eliminarFotoInformeNovedades(${catIndex}, ${otIndex}, '${foto.id}')"
                    aria-label="Eliminar foto">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </figure>
        `;
    }

    function renderActividadHtml(actividad, catIndex, otIndex, actividadIndex) {
        return `
            <div class="daily-news-activity-row">
                <input type="text"
                    class="form-control"
                    placeholder="Describe la actividad realizada"
                    value="${escapeHtmlDailyNews(actividad.texto)}"
                    oninput="window.actualizarActividadInformeNovedades(${catIndex}, ${otIndex}, ${actividadIndex}, this.value)">
                <button type="button"
                    class="btn btn-outline daily-news-icon-btn"
                    onclick="window.eliminarActividadInformeNovedades(${catIndex}, ${otIndex}, ${actividadIndex})"
                    aria-label="Eliminar actividad">
                    <i class="fa-solid fa-minus"></i>
                </button>
            </div>
        `;
    }

    function renderOtHtml(ot, catIndex, otIndex) {
        const galleryInputId = `daily-news-gallery-${catIndex}-${otIndex}`;
        const cameraInputId = `daily-news-camera-${catIndex}-${otIndex}`;
        const avanceInputId = `daily-news-avance-${catIndex}-${otIndex}`;

        return `
            <article class="daily-news-ot-card">
                <div class="daily-news-ot-top">
                    <div>
                        <span class="daily-news-pill">OT ${otIndex + 1}</span>
                        <h4>Registro manual</h4>
                        <p>Los números, descripciones, actividades y observaciones se escriben manualmente. Planify no autocompleta OTs.</p>
                    </div>
                    <button type="button"
                        class="btn btn-outline daily-news-danger-btn"
                        onclick="window.eliminarOtInformeNovedades(${catIndex}, ${otIndex})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>

                <div class="daily-news-form-grid">
                    <label class="daily-news-field">
                        <span>Número de OT</span>
                        <input type="text"
                            class="form-control"
                            placeholder="Ej: 2002174544"
                            value="${escapeHtmlDailyNews(ot.numero)}"
                            oninput="window.actualizarOtInformeNovedades(${catIndex}, ${otIndex}, 'numero', this.value)">
                    </label>

                    <label class="daily-news-field">
                        <span>Descripción</span>
                        <input type="text"
                            class="form-control"
                            placeholder="Ej: Inspección visual y medición de espesores"
                            value="${escapeHtmlDailyNews(ot.descripcion)}"
                            oninput="window.actualizarOtInformeNovedades(${catIndex}, ${otIndex}, 'descripcion', this.value)">
                    </label>

                    <label class="daily-news-field">
                        <span>% de avance</span>
                        <input type="number"
                            id="${avanceInputId}"
                            class="form-control"
                            placeholder="0 - 100"
                            min="0"
                            max="100"
                            step="1"
                            ${ot.finalizado ? 'disabled' : ''}
                            value="${escapeHtmlDailyNews(ot.avance)}"
                            oninput="window.actualizarOtInformeNovedades(${catIndex}, ${otIndex}, 'avance', this.value)">
                    </label>

                    <label class="daily-news-field daily-news-checkbox-field">
                        <span>Estado</span>
                        <label class="daily-news-checkbox-inline">
                            <input type="checkbox"
                                ${ot.finalizado ? 'checked' : ''}
                                onchange="window.toggleFinalizadoInformeNovedades(${catIndex}, ${otIndex}, this.checked)">
                            <span>Finalizado</span>
                        </label>
                    </label>

                    <label class="daily-news-field daily-news-field--full">
                        <span>Línea de contexto (opcional)</span>
                        <input type="text"
                            class="form-control"
                            placeholder="Ej: Ruta programada:"
                            value="${escapeHtmlDailyNews(ot.contexto)}"
                            oninput="window.actualizarOtInformeNovedades(${catIndex}, ${otIndex}, 'contexto', this.value)">
                    </label>
                </div>

                <section class="daily-news-subsection">
                    <div class="daily-news-subsection-head">
                        <div>
                            <h5>Actividades</h5>
                            <p>Agrega o elimina líneas según necesites.</p>
                        </div>
                        <button type="button" class="btn btn-outline" onclick="window.agregarActividadInformeNovedades(${catIndex}, ${otIndex})">
                            <i class="fa-solid fa-plus"></i> Agregar línea
                        </button>
                    </div>
                    <div class="daily-news-activity-list">
                        ${ot.actividades.map((actividad, actividadIndex) =>
                            renderActividadHtml(actividad, catIndex, otIndex, actividadIndex)).join('')}
                    </div>
                </section>

                <section class="daily-news-subsection">
                    <div class="daily-news-subsection-head">
                        <div>
                            <h5>Observaciones</h5>
                            <p>Texto libre sin viñetas.</p>
                        </div>
                    </div>
                    <textarea
                        class="form-control daily-news-textarea"
                        placeholder="Observaciones de la OT"
                        oninput="window.actualizarOtInformeNovedades(${catIndex}, ${otIndex}, 'observaciones', this.value)">${escapeHtmlDailyNews(ot.observaciones)}</textarea>
                </section>

                <section class="daily-news-subsection">
                    <div class="daily-news-subsection-head">
                        <div>
                            <h5>Fotos vinculadas a esta OT</h5>
                            <p>Se comprimen al 75% antes de guardarse.</p>
                        </div>
                    </div>

                    <input id="${galleryInputId}" type="file" accept="image/*" multiple hidden
                        onchange="window.cargarFotosInformeNovedades(event, ${catIndex}, ${otIndex})">
                    <input id="${cameraInputId}" type="file" accept="image/*" capture="environment" hidden
                        onchange="window.cargarFotosInformeNovedades(event, ${catIndex}, ${otIndex})">

                    <div class="daily-news-photo-actions">
                        <button type="button" class="btn btn-outline" onclick="document.getElementById('${cameraInputId}').click()">
                            <i class="fa-solid fa-camera"></i> Cámara
                        </button>
                        <button type="button" class="btn btn-outline" onclick="document.getElementById('${galleryInputId}').click()">
                            <i class="fa-regular fa-image"></i> Galería
                        </button>
                    </div>

                    ${ot.fotos.length
                        ? `<div class="daily-news-photo-grid">${ot.fotos.map(foto => renderFotoPreviewHtml(foto, catIndex, otIndex)).join('')}</div>`
                        : `<div class="empty-state empty-state--compact"><div><strong>Sin fotos adjuntas</strong><p>Las imágenes quedarán asociadas directamente a esta OT y se insertarán en el Word.</p></div></div>`}
                </section>
            </article>
        `;
    }

    function renderCategoriaHtml(categoria, catIndex) {
        return `
            <section class="daily-news-category-card">
                <div class="daily-news-category-head">
                    <div class="daily-news-category-title">
                        <span class="daily-news-pill">Categoría ${catIndex + 1}</span>
                        <input type="text"
                            class="form-control"
                            placeholder="Ej: Trabajos Varios, Lubricación, Termografía..."
                            value="${escapeHtmlDailyNews(categoria.nombre)}"
                            oninput="window.actualizarCategoriaInformeNovedades(${catIndex}, 'nombre', this.value)">
                    </div>
                    <div class="daily-news-category-actions">
                        <button type="button" class="btn btn-outline" onclick="window.agregarOtInformeNovedades(${catIndex})">
                            <i class="fa-solid fa-plus"></i> Agregar OT
                        </button>
                        <button type="button" class="btn btn-outline daily-news-danger-btn" onclick="window.eliminarCategoriaInformeNovedades(${catIndex})">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>

                ${categoria.ots.length
                    ? `<div class="daily-news-ot-list">${categoria.ots.map((ot, otIndex) => renderOtHtml(ot, catIndex, otIndex)).join('')}</div>`
                    : `<div class="empty-state empty-state--compact"><div><strong>Sin OTs todavía</strong><p>Agrega una OT manual y completa número, descripción, actividades, observaciones y fotos.</p></div></div>`}
            </section>
        `;
    }

    function construirInformeNovedadesModalHtml(informe) {
        const conteos = getConteosInformeNovedades(informe);

        return `
            <div id="${DAILY_NEWS_MODAL_ID}" class="modal-overlay-base" style="display:flex;" onclick="window.handleDailyNewsOverlayClick(event)">
                <div class="modal-shell modal-shell--wide daily-news-modal-shell">
                    <div class="modal-head">
                        <div class="modal-title-wrap">
                            <span class="modal-eyebrow"><i class="fa-solid fa-file-lines"></i> Diario</span>
                            <h2 class="modal-title">📋 Informe de Novedades Diarias</h2>
                            <p class="modal-subtitle">Usa el documento de referencia APPLUS como plantilla real de exportación y completa cada OT manualmente.</p>
                        </div>
                        <button type="button" class="modal-close" onclick="window.cerrarInformeNovedadesDiarias()" aria-label="Cerrar">&times;</button>
                    </div>

                    <div class="modal-scroll daily-news-modal-scroll">
                        <section class="daily-news-summary-card">
                            <div class="daily-news-summary-main">
                                <span class="daily-news-summary-label">Fecha del informe</span>
                                <input type="date"
                                    class="form-control daily-news-date-input"
                                    value="${escapeHtmlDailyNews(informe.fecha)}"
                                    onchange="window.actualizarFechaInformeNovedades(this.value)">
                                <p>El título del Word se genera automáticamente como: <strong>${escapeHtmlDailyNews(formatearTituloInformeNovedades(informe.fecha))}</strong></p>
                            </div>
                            <div class="daily-news-summary-stats">
                                <article>
                                    <strong>${conteos.categorias}</strong>
                                    <span>Categorías</span>
                                </article>
                                <article>
                                    <strong>${conteos.ots}</strong>
                                    <span>OTs</span>
                                </article>
                                <article>
                                    <strong>${conteos.fotos}</strong>
                                    <span>Fotos</span>
                                </article>
                            </div>
                        </section>

                        <section class="daily-news-toolbar">
                            <div>
                                <h3>Estructura del informe</h3>
                                <p>Cada categoría se exporta en su propia página, con sus OTs, actividades, observaciones y fotos embebidas.</p>
                            </div>
                            <button type="button" class="btn btn-primary" onclick="window.agregarCategoriaInformeNovedades()">
                                <i class="fa-solid fa-plus"></i> Agregar categoría
                            </button>
                        </section>

                        ${informe.categorias.length
                            ? `<div class="daily-news-category-stack">${informe.categorias.map((categoria, catIndex) => renderCategoriaHtml(categoria, catIndex)).join('')}</div>`
                            : `<div class="empty-state"><div><strong>Tu informe está vacío</strong><p>Empieza agregando una categoría y luego suma las OTs manualmente tal como deben aparecer en el Word.</p></div></div>`}
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn btn-success" onclick="window.exportarInformeNovedadesWord(event)">
                            <i class="fa-solid fa-file-word"></i> Exportar Word
                        </button>
                        <button type="button" class="btn btn-outline" onclick="window.cerrarInformeNovedadesDiarias()">Cerrar</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderInformeNovedadesDiariasModal({ preserveScroll = 0 } = {}) {
        const informe = getInformeNovedadesState();
        cerrarInformeNovedadesDiariasModal();
        document.body.insertAdjacentHTML('beforeend', construirInformeNovedadesModalHtml(informe));
        registrarEscapeInformeNovedades();

        if (preserveScroll > 0) {
            requestAnimationFrame(() => {
                const scrollEl = document.querySelector(`#${DAILY_NEWS_MODAL_ID} .daily-news-modal-scroll`);
                if (scrollEl) scrollEl.scrollTop = preserveScroll;
            });
        }
    }

    function rerenderInformeNovedadesDiariasModal() {
        const scrollEl = document.querySelector(`#${DAILY_NEWS_MODAL_ID} .daily-news-modal-scroll`);
        const preserveScroll = scrollEl ? scrollEl.scrollTop : 0;
        renderInformeNovedadesDiariasModal({ preserveScroll });
    }

    async function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen comprimida.'));
            reader.readAsDataURL(blob);
        });
    }

    async function cargarImagenDesdeArchivo(file) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            const objectUrl = URL.createObjectURL(file);
            image.onload = async () => {
                try {
                    if (typeof image.decode === 'function') {
                        await image.decode().catch(() => {});
                    }
                    resolve({ image, objectUrl });
                } catch (error) {
                    reject(error);
                }
            };
            image.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
            image.src = objectUrl;
        });
    }

    async function comprimirFotoInformeNovedades(file) {
        const { image, objectUrl } = await cargarImagenDesdeArchivo(file);
        try {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth || image.width || 1;
            canvas.height = image.naturalHeight || image.height || 1;

            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('No se pudo preparar el lienzo para comprimir la imagen.');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/jpeg', DAILY_NEWS_IMAGE_QUALITY);
            });

            if (!blob) throw new Error('No se pudo comprimir la imagen seleccionada.');

            return {
                id: crypto.randomUUID(),
                name: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpeg',
                dataUrl: await blobToDataUrl(blob),
                width: canvas.width,
                height: canvas.height,
                mimeType: 'image/jpeg',
                size: blob.size,
            };
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function normalizarAvanceInformeNovedades(avance) {
        const texto = String(avance || '').trim().replace(',', '.');
        if (!texto) return '';
        const numero = Number(texto);
        if (Number.isNaN(numero)) return '';
        return String(Math.max(0, Math.min(100, Math.round(numero))));
    }

    function limpiarTextoFinal(texto) {
        return String(texto || '').trim().replace(/\s+/g, ' ');
    }

    function construirTituloOtExport(ot) {
        const numero = limpiarTextoFinal(ot.numero);
        const descripcion = limpiarTextoFinal(ot.descripcion);
        let base = numero ? `OT ${numero}` : 'OT';
        if (descripcion) base += numero ? `, ${descripcion}` : ` ${descripcion}`;
        if (descripcion && !/[.!?]$/.test(descripcion)) base += '.';

        if (ot.finalizado) return `${base} (finalizado)`;

        const avance = normalizarAvanceInformeNovedades(ot.avance);
        return avance ? `${base} (Avance ${avance}%)` : base;
    }

    function construirPieFotoExport(ot) {
        const numero = limpiarTextoFinal(ot.numero);
        const descripcion = limpiarTextoFinal(ot.descripcion);
        if (numero && descripcion) return `OT ${numero} - ${descripcion}`;
        if (numero) return `OT ${numero}`;
        if (descripcion) return descripcion;
        return 'OT sin descripción';
    }

    function obtenerCategoriasExportables(informe) {
        return informe.categorias
            .map((categoria, catIndex) => {
                const ots = categoria.ots
                    .map(normalizarOtInformeNovedades)
                    .map(ot => ({
                        ...ot,
                        numero: limpiarTextoFinal(ot.numero),
                        descripcion: limpiarTextoFinal(ot.descripcion),
                        contexto: String(ot.contexto || '').trim(),
                        actividades: (ot.actividades || [])
                            .map(item => limpiarTextoFinal(item.texto || item))
                            .filter(Boolean),
                        observaciones: String(ot.observaciones || '').trim(),
                    }))
                    .filter(ot => ot.numero || ot.descripcion || ot.contexto || ot.actividades.length || ot.observaciones || ot.fotos.length);

                return {
                    id: categoria.id,
                    nombre: limpiarTextoFinal(categoria.nombre) || `Categoría ${catIndex + 1}`,
                    ots,
                };
            })
            .filter(categoria => categoria.ots.length > 0);
    }

    function createRunDailyNews(texto, { bold = false, italic = false, underline = false, size = 22 } = {}) {
        const preserve = /^\s|\s$/.test(texto) ? ' xml:space="preserve"' : '';
        return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${bold ? '<w:b/><w:bCs/>' : ''}${italic ? '<w:i/><w:iCs/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}<w:color w:val="000000"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="es-419" w:eastAsia="es-419"/></w:rPr><w:t${preserve}>${escapeXmlDailyNews(texto)}</w:t></w:r>`;
    }

    function createParagraphDailyNews(
        runs,
        {
            align = '',
            styleId = '',
            indentLeft = '',
            before = null,
            after = null,
            line = null,
            contextualSpacing = false,
            numberingId = '',
            numberingLevel = 0,
        } = {}
    ) {
        const pPr = [];
        if (styleId) pPr.push(`<w:pStyle w:val="${styleId}"/>`);
        if (numberingId !== '' && numberingId !== null && numberingId !== undefined) {
            pPr.push(`<w:numPr><w:ilvl w:val="${numberingLevel}"/><w:numId w:val="${numberingId}"/></w:numPr>`);
        }
        if (align) pPr.push(`<w:jc w:val="${align}"/>`);
        if (indentLeft) pPr.push(`<w:ind w:left="${indentLeft}"/>`);
        if (before !== null || after !== null || line !== null) {
            const spacingBefore = before ?? 0;
            const spacingAfter = after ?? 0;
            const spacingLine = line ?? 240;
            pPr.push(`<w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="${spacingLine}" w:lineRule="auto"/>`);
        }
        if (contextualSpacing) pPr.push('<w:contextualSpacing/>');
        const normalizedRuns = numberingId !== '' && numberingId !== null && numberingId !== undefined
            ? String(runs).replace(/(<w:t[^>]*>)(?:â€“\s+|–\s+|&#8211;\s+|&#x2013;\s+)/, '$1')
            : runs;
        return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${normalizedRuns}</w:p>`;
    }

    function createEmptyParagraphDailyNews() {
        return createParagraphDailyNews('', { after: 0, line: 240 });
    }

    function createPageBreakParagraphDailyNews() {
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }

    function dataUrlToBytesDailyNews(dataUrl) {
        const [, base64 = ''] = String(dataUrl || '').split(',');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function getImageDimensionsEmu(photo) {
        const widthPx = Math.max(Number(photo.width || 0) || 0, 1);
        const heightPx = Math.max(Number(photo.height || 0) || 0, 1);
        const widthEmu = widthPx * 9525;
        const heightEmu = heightPx * 9525;
        const scale = widthEmu > WORD_IMAGE_MAX_WIDTH_EMU ? WORD_IMAGE_MAX_WIDTH_EMU / widthEmu : 1;
        return {
            width: Math.round(widthEmu * scale),
            height: Math.round(heightEmu * scale),
        };
    }

    function createImageParagraphDailyNews(rId, dimensions, docPrId, altText) {
        return createParagraphDailyNews(
            `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${dimensions.width}" cy="${dimensions.height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="Imagen ${docPrId}" descr="${escapeXmlDailyNews(altText)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Imagen ${docPrId}" descr="${escapeXmlDailyNews(altText)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}" cstate="print"><a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${dimensions.width}" cy="${dimensions.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
            { align: 'center', after: 0 }
        );
    }

    function descargarBlobDailyNews(blob, fileName) {
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(anchor);
    }

    window.abrirInformeNovedadesDiarias = async function() {
        await asegurarInformeNovedadesCargado();
        renderInformeNovedadesDiariasModal();
    };

    window.cerrarInformeNovedadesDiarias = function() {
        cerrarInformeNovedadesDiariasModal();
    };

    window.handleDailyNewsOverlayClick = function(event) {
        if (event.target?.id === DAILY_NEWS_MODAL_ID) {
            cerrarInformeNovedadesDiariasModal();
        }
    };

    window.actualizarFechaInformeNovedades = function(valor) {
        const informe = getInformeNovedadesState();
        informe.fecha = normalizarFechaInformeNovedades(valor);
        setInformeNovedadesState(informe);
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.actualizarCategoriaInformeNovedades = function(catIndex, field, value) {
        const informe = getInformeNovedadesState();
        const categoria = informe.categorias[catIndex];
        if (!categoria) return;
        categoria[field] = String(value || '');
        setInformeNovedadesState(informe);
        programarGuardadoInformeNovedades();
    };

    window.agregarCategoriaInformeNovedades = function() {
        const informe = getInformeNovedadesState();
        informe.categorias.push(crearCategoriaInformeNovedades(''));
        setInformeNovedadesState(informe);
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.eliminarCategoriaInformeNovedades = function(catIndex) {
        const informe = getInformeNovedadesState();
        if (!informe.categorias[catIndex]) return;
        informe.categorias.splice(catIndex, 1);
        setInformeNovedadesState(informe);
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.agregarOtInformeNovedades = function(catIndex) {
        const informe = getInformeNovedadesState();
        const categoria = informe.categorias[catIndex];
        if (!categoria) return;
        categoria.ots.push(crearOtInformeNovedades());
        setInformeNovedadesState(informe);
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.eliminarOtInformeNovedades = function(catIndex, otIndex) {
        const informe = getInformeNovedadesState();
        const categoria = informe.categorias[catIndex];
        if (!categoria?.ots?.[otIndex]) return;
        categoria.ots.splice(otIndex, 1);
        setInformeNovedadesState(informe);
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.actualizarOtInformeNovedades = function(catIndex, otIndex, field, value) {
        const ot = getOtMutable(catIndex, otIndex);
        if (!ot) return;
        ot[field] = String(value ?? '');
        programarGuardadoInformeNovedades();
    };

    window.toggleFinalizadoInformeNovedades = function(catIndex, otIndex, checked) {
        const ot = getOtMutable(catIndex, otIndex);
        if (!ot) return;
        ot.finalizado = Boolean(checked);
        if (ot.finalizado) ot.avance = '';

        const input = document.getElementById(`daily-news-avance-${catIndex}-${otIndex}`);
        if (input) {
            input.disabled = ot.finalizado;
            if (ot.finalizado) input.value = '';
        }

        programarGuardadoInformeNovedades();
    };

    window.agregarActividadInformeNovedades = function(catIndex, otIndex) {
        const ot = getOtMutable(catIndex, otIndex);
        if (!ot) return;
        ot.actividades.push(crearActividadInformeNovedades(''));
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.actualizarActividadInformeNovedades = function(catIndex, otIndex, actividadIndex, valor) {
        const ot = getOtMutable(catIndex, otIndex);
        if (!ot?.actividades?.[actividadIndex]) return;
        ot.actividades[actividadIndex].texto = String(valor || '');
        programarGuardadoInformeNovedades();
    };

    window.eliminarActividadInformeNovedades = function(catIndex, otIndex, actividadIndex) {
        const ot = getOtMutable(catIndex, otIndex);
        if (!ot?.actividades?.[actividadIndex]) return;
        ot.actividades.splice(actividadIndex, 1);
        if (!ot.actividades.length) ot.actividades.push(crearActividadInformeNovedades(''));
        programarGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.cargarFotosInformeNovedades = async function(event, catIndex, otIndex) {
        const files = Array.from(event?.target?.files || []).filter(file => String(file.type || '').startsWith('image/'));
        if (event?.target) event.target.value = '';
        if (!files.length) return;

        const ot = getOtMutable(catIndex, otIndex);
        if (!ot) return;

        try {
            const fotos = [];
            for (const file of files) {
                fotos.push(await comprimirFotoInformeNovedades(file));
            }
            ot.fotos.push(...fotos);
            await flushGuardadoInformeNovedades();
            rerenderInformeNovedadesDiariasModal();
        } catch (error) {
            console.error('[Novedades] Error adjuntando fotos:', error);
            alert(error?.message || 'No se pudieron adjuntar las fotos seleccionadas.');
        }
    };

    window.eliminarFotoInformeNovedades = async function(catIndex, otIndex, fotoId) {
        const ot = getOtMutable(catIndex, otIndex);
        if (!ot) return;
        ot.fotos = ot.fotos.filter(foto => String(foto.id) !== String(fotoId));
        await flushGuardadoInformeNovedades();
        rerenderInformeNovedadesDiariasModal();
    };

    window.exportarInformeNovedadesWord = async function(trigger) {
        const button = trigger?.target?.closest('button') || document.querySelector(`#${DAILY_NEWS_MODAL_ID} .btn.btn-success`);
        const originalHtml = button ? button.innerHTML : '';

        try {
            if (!window.PizZip) throw new Error('La librería Word no está disponible en esta sesión.');
            if (button) {
                button.disabled = true;
                button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exportando...';
            }

            const informe = await asegurarInformeNovedadesCargado();
            await flushGuardadoInformeNovedades();
            const categorias = obtenerCategoriasExportables(informe);

            if (!categorias.length) {
                throw new Error('Agrega al menos una categoría con contenido antes de exportar el Word.');
            }

            const response = await fetch(DAILY_NEWS_TEMPLATE_URL);
            if (!response.ok) throw new Error('No se pudo cargar el documento de referencia de APPLUS.');

            const content = await response.arrayBuffer();
            const zip = new window.PizZip(content);
            let documentXml = zip.file('word/document.xml')?.asText();
            let relsXml = zip.file('word/_rels/document.xml.rels')?.asText();

            if (!documentXml || !relsXml) {
                throw new Error('La plantilla Word no contiene la estructura esperada.');
            }

            const prefixMatch = documentXml.match(/^([\s\S]*?<w:body>)/);
            const sectPrMatch = documentXml.match(/(<w:sectPr[\s\S]*?<\/w:sectPr>)\s*<\/w:body>\s*<\/w:document>\s*$/);
            if (!prefixMatch || !sectPrMatch) {
                throw new Error('No se pudo reutilizar el encabezado y formato del documento de referencia.');
            }

            let maxRid = 0;
            relsXml.replace(/Id="rId(\d+)"/g, (_match, id) => {
                maxRid = Math.max(maxRid, Number(id) || 0);
                return _match;
            });

            let nextRid = maxRid + 1;
            let nextDocPrId = 5000;
            const nuevasRelaciones = [];
            const bodyParts = [];

            bodyParts.push(createParagraphDailyNews(
                createRunDailyNews(formatearTituloInformeNovedades(informe.fecha), { bold: true }),
                { align: 'center' }
            ));
            bodyParts.push(createEmptyParagraphDailyNews());

            categorias.forEach((categoria, catIndex) => {
                if (catIndex > 0) bodyParts.push(createPageBreakParagraphDailyNews());

                bodyParts.push(createParagraphDailyNews(
                    createRunDailyNews(`${categoria.nombre}:`, { bold: true, underline: true }),
                    {}
                ));
                bodyParts.push(createEmptyParagraphDailyNews());

                categoria.ots.forEach((ot, otIndex) => {
                    if (ot.contexto) {
                        bodyParts.push(createParagraphDailyNews(
                            createRunDailyNews(ot.contexto, { underline: true }),
                            {}
                        ));
                    }

                    bodyParts.push(createParagraphDailyNews(
                        createRunDailyNews(construirTituloOtExport(ot), { bold: true }),
                        {}
                    ));

                    ot.actividades.forEach(actividad => {
                        bodyParts.push(createParagraphDailyNews(
                            createRunDailyNews(`– ${actividad}`),
                            { styleId: 'Prrafodelista', numberingId: WORD_ACTIVITY_NUM_ID, numberingLevel: 0, contextualSpacing: true }
                        ));
                    });

                    if (ot.observaciones) {
                        ot.observaciones.split(/\r?\n/).forEach(linea => {
                            if (linea.trim()) {
                                bodyParts.push(createParagraphDailyNews(createRunDailyNews(linea.trim()), {}));
                            } else {
                                bodyParts.push(createEmptyParagraphDailyNews());
                            }
                        });
                    }

                    ot.fotos.forEach((foto, fotoIndex) => {
                        const extension = String(foto.mimeType || '').includes('png') ? 'png' : 'jpeg';
                        const relationId = `rId${nextRid++}`;
                        const mediaFileName = `planify-novedades-${Date.now()}-${catIndex}-${otIndex}-${fotoIndex}.${extension}`;
                        const bytes = dataUrlToBytesDailyNews(foto.dataUrl);
                        zip.file(`word/media/${mediaFileName}`, bytes);
                        nuevasRelaciones.push(`<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFileName}"/>`);

                        bodyParts.push(createImageParagraphDailyNews(
                            relationId,
                            getImageDimensionsEmu(foto),
                            nextDocPrId++,
                            construirPieFotoExport(ot)
                        ));
                        bodyParts.push(createParagraphDailyNews(
                            createRunDailyNews(construirPieFotoExport(ot), { italic: true, size: 18 }),
                            { align: 'center', after: 80 }
                        ));
                    });

                    if (otIndex < categoria.ots.length - 1) {
                        bodyParts.push(createEmptyParagraphDailyNews());
                    }
                });
            });

            if (nuevasRelaciones.length) {
                relsXml = relsXml.replace('</Relationships>', `${nuevasRelaciones.join('')}</Relationships>`);
                zip.file('word/_rels/document.xml.rels', relsXml);
            }

            documentXml = `${prefixMatch[1]}${bodyParts.join('')}${sectPrMatch[1]}</w:body></w:document>`;
            zip.file('word/document.xml', documentXml);

            const out = zip.generate({
                type: 'blob',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });

            descargarBlobDailyNews(out, `Novedades_${informe.fecha}.docx`);

            if (button) {
                button.innerHTML = '<i class="fa-solid fa-check"></i> Word generado';
                setTimeout(() => {
                    button.innerHTML = originalHtml;
                    button.disabled = false;
                }, 1800);
            }
        } catch (error) {
            console.error('[Novedades] Error exportando Word:', error);
            alert(error?.message || 'No se pudo generar el documento Word.');
            if (button) {
                button.innerHTML = originalHtml;
                button.disabled = false;
            }
        }
    };
})();
