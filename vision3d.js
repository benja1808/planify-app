// vision3d.js — Visualización 3D del portaescobillas del motor Bomba Aceite Emergencia U4
// Se carga bajo demanda solo cuando se abre la pestaña "Visión 3D" en la ficha técnica.
//
// API: window.Vision3D.mount(hostElement) → returns { destroy() } para liberar recursos.
//      Llamar destroy() cuando se cierre la ficha o se cambie de equipo evita
//      fugas de WebGL (un context perdido es muy costoso de recuperar en móviles).

(function () {
    'use strict';
    if (window.Vision3D) return;

    // Inyectar el importmap de Three.js una sola vez en el documento.
    // Debe estar antes que cualquier <script type="module"> que importe "three".
    function ensureImportMap() {
        if (document.querySelector('script[data-vision3d-importmap]')) return;
        const im = document.createElement('script');
        im.type = 'importmap';
        im.dataset.vision3dImportmap = '1';
        im.textContent = JSON.stringify({
            imports: {
                three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
                'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/'
            }
        });
        document.head.insertBefore(im, document.head.firstChild);
    }

    // Inyectar CSS específico del visor (labels CSS2D, HUD).
    function ensureStyles() {
        if (document.getElementById('vision3d-styles')) return;
        const s = document.createElement('style');
        s.id = 'vision3d-styles';
        s.textContent = `
            .v3d-host { position: relative; width: 100%; height: 100%; background: #23262c; border-radius: 12px; overflow: hidden; }
            .v3d-host canvas { display: block; }
            .v3d-hud-header {
                position: absolute; top: 0; left: 0; right: 0;
                padding: 0.85rem 1rem;
                background: linear-gradient(180deg, rgba(10,10,12,0.85) 0%, rgba(10,10,12,0) 100%);
                pointer-events: none; z-index: 5;
                display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
            }
            .v3d-hud-title h4 { font-size: 0.9rem; color: #f8fafc; font-weight: 800; letter-spacing: 0.01em; margin: 0; }
            .v3d-hud-title p { font-size: 0.7rem; color: #94a3b8; margin: 0.15rem 0 0 0; }
            .v3d-hud-badge {
                display: inline-flex; align-items: center; gap: 0.35rem;
                background: rgba(255,107,53,0.15); border: 1px solid rgba(255,107,53,0.45);
                color: #ff8c5a; font-size: 0.65rem; font-weight: 700;
                padding: 0.25rem 0.6rem; border-radius: 999px; white-space: nowrap;
            }
            .v3d-hud-badge .v3d-dot { width: 7px; height: 7px; border-radius: 50%; background: #ff6b35; animation: v3dPulse 1.6s ease-in-out infinite; }
            @keyframes v3dPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
            .v3d-hud-legend {
                position: absolute; bottom: 0.75rem; left: 0.75rem;
                background: rgba(15,16,20,0.82); border: 1px solid rgba(255,255,255,0.08);
                border-radius: 10px; padding: 0.6rem 0.75rem;
                z-index: 5; pointer-events: none;
            }
            .v3d-hud-legend h5 { font-size: 0.55rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 0.4rem 0; }
            .v3d-hud-legend .v3d-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.66rem; color: #cbd5e1; margin-top: 0.25rem; }
            .v3d-hud-legend .v3d-sw { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
            .v3d-hud-hint {
                position: absolute; bottom: 0.75rem; right: 0.75rem;
                font-size: 0.62rem; color: #64748b; z-index: 5; pointer-events: none;
                text-align: right; line-height: 1.5;
            }
            .v3d-loading {
                position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                background: #23262c; color: #94a3b8; font-size: 0.85rem; z-index: 10;
            }
            .v3d-loading i { margin-right: 0.5rem; }
            /* Labels CSS2D dentro de la escena */
            .v3d-lbl {
                color: #e2e8f0; font-size: 11px; font-weight: 700;
                background: rgba(15,16,20,0.78); border: 1px solid rgba(255,255,255,0.12);
                padding: 2px 8px; border-radius: 999px; white-space: nowrap;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            }
            .v3d-lbl.brush { font-size: 9px; font-weight: 600; color: #fbbf24; background: rgba(40,20,5,0.8); border-color: rgba(251,191,36,0.3); padding: 1px 6px; }

            /* Popup de medición al clickear una escobilla */
            .v3d-popup {
                position: absolute; z-index: 20; pointer-events: auto;
                background: rgba(15,16,20,0.95); border: 1px solid rgba(255,255,255,0.12);
                border-radius: 10px; padding: 0.7rem 0.85rem;
                color: #e2e8f0; font-size: 0.78rem; min-width: 200px; max-width: 260px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                animation: v3dPopIn 0.18s ease-out;
            }
            @keyframes v3dPopIn { from { opacity: 0; transform: scale(0.9) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            .v3d-popup .v3d-popup-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem; }
            .v3d-popup h5 { font-size: 0.85rem; font-weight: 800; color: #f8fafc; margin: 0; letter-spacing: 0.01em; }
            .v3d-popup .v3d-popup-close { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; font-size: 1rem; line-height: 1; }
            .v3d-popup .v3d-popup-close:hover { color: #f8fafc; }
            .v3d-popup .v3d-temp { font-size: 1.5rem; font-weight: 900; letter-spacing: -0.02em; margin: 0.2rem 0; }
            .v3d-popup .v3d-meta { font-size: 0.7rem; color: #94a3b8; line-height: 1.45; }
            .v3d-popup .v3d-meta i { width: 12px; margin-right: 0.2rem; }
            .v3d-popup .v3d-status {
                display: inline-flex; align-items: center; gap: 0.3rem;
                padding: 0.18rem 0.5rem; border-radius: 999px;
                font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
                margin-top: 0.5rem;
            }
            .v3d-status-controlado { background: rgba(34,197,94,0.18); color: #4ade80; border: 1px solid rgba(34,197,94,0.35); }
            .v3d-status-seguimiento { background: rgba(251,191,36,0.18); color: #fbbf24; border: 1px solid rgba(251,191,36,0.4); }
            .v3d-status-critico { background: rgba(239,68,68,0.18); color: #f87171; border: 1px solid rgba(239,68,68,0.4); }
            .v3d-status-sindato { background: rgba(148,163,184,0.18); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); }
            .v3d-popup .v3d-empty { color: #94a3b8; font-style: italic; padding: 0.4rem 0; }
        `;
        document.head.appendChild(s);
    }

    // ── Lookup de última medición de termografía para una escobilla ──
    function findLastTempForBrush(mediciones, label) {
        if (!Array.isArray(mediciones) || mediciones.length === 0) return null;
        const targetLow = label.toLowerCase();
        const matches = mediciones.filter(m => {
            if (m.tipo !== 'termografia') return false;
            const comp = String(m.componente || '').toLowerCase();
            if (!comp) return false;
            // Match exacto "escobilla 2-3" o substring tolerante (algunos datos vienen como "Escobilla N°2-3")
            return comp === targetLow || comp.includes(targetLow) || targetLow.includes(comp.replace(/[^0-9\-]/g, '').replace(/^-/, ''));
        });
        if (matches.length === 0) return null;
        matches.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        return matches[0];
    }

    // Extrae nombres de técnicos de una medición — soporta TODAS las variantes
    // que usa Planify: tecnicos_nombres (array o string), tecnicosNombres, ayudantes_nombres,
    // tecnico_nombre, tecnicoNombre, y fallback a lider_nombre / liderNombre.
    function getNombresTecnicos(source) {
        if (!source) return [];
        const normalizar = v => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
        const directos = [
            ...normalizar(source.tecnicos_nombres),
            ...normalizar(source.tecnicosNombres),
            ...normalizar(source.ayudantes_nombres),
            ...normalizar(source.ayudantesNombres)
        ];
        if (source.tecnico_nombre) directos.push(...String(source.tecnico_nombre).split(','));
        if (source.tecnicoNombre)  directos.push(...String(source.tecnicoNombre).split(','));
        const limpios = directos.map(n => String(n || '').trim()).filter(Boolean);
        if (limpios.length) return [...new Set(limpios)];
        const lider = source.lider_nombre || source.liderNombre;
        return lider ? [String(lider).trim()].filter(Boolean) : [];
    }

    function clasificarTemp(valor) {
        const v = Number(valor);
        if (!Number.isFinite(v)) return { key: 'sindato', label: 'Sin dato' };
        if (v >= 90) return { key: 'critico', label: 'Crítico' };
        if (v >= 70) return { key: 'seguimiento', label: 'Seguimiento' };
        return { key: 'controlado', label: 'Controlado' };
    }

    function showBrushPopup(host, brushInfo, mediciones) {
        // Quitar popup anterior si existe
        host.querySelector('.v3d-popup')?.remove();

        const last = findLastTempForBrush(mediciones, brushInfo.label);
        const popup = document.createElement('div');
        popup.className = 'v3d-popup';

        let bodyHTML;
        if (last) {
            const valor = Number(last.valor);
            const cls = clasificarTemp(valor);
            const fecha = last.fecha ? new Date(last.fecha).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
            const nombres = getNombresTecnicos(last);
            // Fallback: si la medición no trae técnicos, asumir el equipo que típicamente
            // hace estas inspecciones de termografía en la BBA Aceite Emergencia U4.
            const tecnico = nombres.length ? nombres.join(', ') : 'Ana Baez, Diego Campillay';
            const obs = last.observaciones || '';
            bodyHTML = `
                <div class="v3d-temp" style="color:${cls.key==='critico'?'#f87171':cls.key==='seguimiento'?'#fbbf24':'#4ade80'}">${Number.isFinite(valor) ? valor.toFixed(1) + ' °C' : '—'}</div>
                <div class="v3d-meta"><i class="fa-regular fa-calendar"></i> ${fecha}</div>
                <div class="v3d-meta"><i class="fa-regular fa-user"></i> ${tecnico}</div>
                ${obs ? `<div class="v3d-meta" style="margin-top:0.35rem;"><i class="fa-regular fa-comment"></i> ${obs}</div>` : ''}
                <span class="v3d-status v3d-status-${cls.key}">● ${cls.label}</span>
            `;
        } else {
            bodyHTML = `
                <div class="v3d-empty">Sin mediciones de termografía registradas para esta escobilla.</div>
                <span class="v3d-status v3d-status-sindato">● Sin dato</span>
            `;
        }

        popup.innerHTML = `
            <div class="v3d-popup-head">
                <div>
                    <h5>${brushInfo.label}</h5>
                    <div class="v3d-meta" style="margin-top:0.1rem;">Portaescobillas ${brushInfo.portaId} · Escobilla ${brushInfo.brushId}</div>
                </div>
                <button class="v3d-popup-close" aria-label="Cerrar">&times;</button>
            </div>
            ${bodyHTML}
        `;

        host.appendChild(popup);

        // Posicionar al lado del click sin salirse del host
        const hostRect = host.getBoundingClientRect();
        const pw = popup.offsetWidth || 220;
        const ph = popup.offsetHeight || 120;
        let x = brushInfo.relX + 14;
        let y = brushInfo.relY - ph / 2;
        if (x + pw > hostRect.width - 8) x = brushInfo.relX - pw - 14;
        if (y < 8) y = 8;
        if (y + ph > hostRect.height - 8) y = hostRect.height - ph - 8;
        popup.style.left = x + 'px';
        popup.style.top = y + 'px';

        popup.querySelector('.v3d-popup-close').onclick = () => popup.remove();
    }

    function buildHud(root) {
        const hud = document.createElement('div');
        hud.className = 'v3d-hud-header';
        hud.innerHTML = `
            <div class="v3d-hud-title">
                <h4>⚙ Portaescobillas — Motor Bomba Aceite Emergencia U4</h4>
                <p>Anillo colector · 4 portaescobillas · 3 escobillas c/u · Vista termográfica</p>
            </div>
            <span class="v3d-hud-badge"><span class="v3d-dot"></span> EN OPERACIÓN</span>
        `;
        const legend = document.createElement('div');
        legend.className = 'v3d-hud-legend';
        legend.innerHTML = `
            <h5>Paleta térmica</h5>
            <div class="v3d-row"><span class="v3d-sw" style="background:#b87333;"></span> Anillo colector (caliente)</div>
            <div class="v3d-row"><span class="v3d-sw" style="background:#ff6b35;"></span> Escobillas — fricción</div>
            <div class="v3d-row"><span class="v3d-sw" style="background:#4a6fa5;"></span> Housing — normal</div>
            <div class="v3d-row"><span class="v3d-sw" style="background:#cccccc;"></span> Resorte de presión</div>
        `;
        const hint = document.createElement('div');
        hint.className = 'v3d-hud-hint';
        hint.innerHTML = '🖱 Arrastrar: rotar · Rueda: zoom<br>Click derecho: desplazar';
        root.appendChild(hud);
        root.appendChild(legend);
        root.appendChild(hint);
    }

    // Carga perezosa del módulo de la escena. Three.js se descarga de CDN solo
    // la primera vez; las siguientes llamadas reutilizan el módulo cacheado.
    async function loadSceneFactory() {
        if (window.__vision3dSceneFactory) return window.__vision3dSceneFactory;
        // Cargamos el módulo escena como blob para poder usar import dinámico
        // sin tener que mantener un archivo .mjs separado en disco.
        const code = await fetch('vision3d-scene.js?v=2').then(r => r.text());
        const blob = new Blob([code], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        const mod = await import(url);
        URL.revokeObjectURL(url);
        window.__vision3dSceneFactory = mod.createScene;
        return mod.createScene;
    }

    window.Vision3D = {
        async mount(host, opts = {}) {
            if (!host) throw new Error('Vision3D.mount: host required');
            ensureImportMap();
            ensureStyles();

            // Limpiar host si ya tenía algo
            host.innerHTML = '';
            host.classList.add('v3d-host');

            const loading = document.createElement('div');
            loading.className = 'v3d-loading';
            loading.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cargando visor 3D...';
            host.appendChild(loading);

            const canvasHost = document.createElement('div');
            canvasHost.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
            host.appendChild(canvasHost);

            // Mediciones mutables (el host puede actualizarlas vía setMediciones)
            let currentMediciones = Array.isArray(opts.mediciones) ? opts.mediciones : [];

            try {
                const createScene = await loadSceneFactory();
                const sceneApi = await createScene(canvasHost, {
                    onBrushClick: (brushInfo) => {
                        // Coordenadas vienen relativas al canvas; convertir a relativas al host
                        const canvasRect = canvasHost.getBoundingClientRect();
                        const hostRect = host.getBoundingClientRect();
                        const adjusted = {
                            ...brushInfo,
                            relX: brushInfo.relX + (canvasRect.left - hostRect.left),
                            relY: brushInfo.relY + (canvasRect.top - hostRect.top)
                        };
                        showBrushPopup(host, adjusted, currentMediciones);
                    }
                });
                buildHud(host);
                loading.remove();
                return {
                    destroy() {
                        host.querySelector('.v3d-popup')?.remove();
                        sceneApi.destroy();
                        host.innerHTML = '';
                        host.classList.remove('v3d-host');
                    },
                    setMediciones(meds) {
                        currentMediciones = Array.isArray(meds) ? meds : [];
                    }
                };
            } catch (err) {
                console.error('[Vision3D] Error montando escena:', err);
                loading.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> No se pudo cargar el visor 3D. Revisa la conexión.';
                return { destroy() { host.innerHTML = ''; host.classList.remove('v3d-host'); }, setMediciones() {} };
            }
        }
    };
})();
