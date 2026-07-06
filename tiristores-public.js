(function () {
    const PUNTOS = ['x1', 'x2', 'y1', 'y2', 'z1', 'z2'];
    const MOD_LABELS = { x: 'X', y: 'Y', z: 'Z' };
    const MOD_PUNTOS = {
        x: { entrada: 'x1', salida1: 'x1', salida2: 'x2' },
        y: { entrada: 'y1', salida1: 'y1', salida2: 'y2' },
        z: { entrada: 'z1', salida1: 'z1', salida2: 'z2' }
    };

    let baseData = {};
    let chart = null;
    let moduloActivo = 'x';

    const $ = id => document.getElementById(id);
    const num = value => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(String(value).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    };
    const horaMin = hora => {
        const m = String(hora || '').match(/^(\d{1,2}):(\d{2})$/);
        return m ? Number(m[1]) * 60 + Number(m[2]) : 99999;
    };
    const fmt = (value, digits = 1) => Number(value || 0).toLocaleString('es-CL', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });

    function medicionBase(id, hora, mw, nota, entradaXYZ, salidaPuntos, unidad = 'U3', extras = {}) {
        const [ex, ey, ez] = entradaXYZ;
        const [x1, x2, y1, y2, z1, z2] = salidaPuntos;
        return {
            id,
            unidad,
            hora,
            mw: String(mw),
            nota,
            entrada: { x1: ex, x2: ex, y1: ey, y2: ey, z1: ez, z2: ez },
            salida: { x1, x2, y1, y2, z1, z2 },
            ...extras,
            created_at: `2026-07-05T${hora || '00:00'}:00`
        };
    }

    // Payload compartido desde la app: viaja en el hash del link (#d= comprimido
    // con LZ-String, #j= base64 de respaldo) e incluye mediciones + vista inicial.
    function leerPayloadCompartido() {
        const m = location.hash.replace(/^#/, '').match(/(?:^|&)(d|j)=([^&]+)/);
        if (!m) return null;
        try {
            const raw = m[1] === 'd'
                ? window.LZString.decompressFromEncodedURIComponent(m[2])
                : decodeURIComponent(escape(atob(decodeURIComponent(m[2]))));
            const data = JSON.parse(raw);
            return data && typeof data === 'object' && data.unidades ? data : null;
        } catch (error) {
            return null;
        }
    }

    const compartido = leerPayloadCompartido();

    async function cargarDatos() {
        if (compartido) {
            baseData = compartido.unidades;
            return;
        }
        const res = await fetch(`app.js?tir=${Date.now()}`, { cache: 'no-store' });
        const text = await res.text();
        const match = text.match(/const TIRISTORES_BASE_PDF = ([\s\S]*?\n};)/);
        if (!match) throw new Error('No se pudo leer la base de tiristores desde app.js');
        const source = match[1].replace(/;\s*$/, '');
        baseData = Function('_tiristoresMedicionBase', `return (${source});`)(medicionBase);
    }

    function leerUnidad(unidad) {
        return (baseData[unidad] || [])
            .map(item => ({
                ...item,
                entrada: item.entrada || {},
                salida: item.salida || {},
                frente: item.frente || {},
                parametros: item.parametros || {}
            }))
            .sort((a, b) => horaMin(a.hora) - horaMin(b.hora) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    }

    function ordenMw(a, b) {
        const ma = num(a?.mw);
        const mb = num(b?.mw);
        const va = Number.isFinite(ma) ? ma : Number.POSITIVE_INFINITY;
        const vb = Number.isFinite(mb) ? mb : Number.POSITIVE_INFINITY;
        return va - vb || horaMin(a?.hora) - horaMin(b?.hora) || String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    }

    function prepararSecuencia(lista, offset = 0, paso = 1) {
        return lista.map((item, index) => ({ ...item, _chartX: index * paso + 1 + offset }));
    }

    function limitarComparacionPorMw(comp, actual) {
        const disponibles = new Map();
        const cargas = [];
        actual.forEach(item => {
            const mw = num(item.mw);
            if (!Number.isFinite(mw)) return;
            cargas.push(mw);
            const key = mw.toFixed(3);
            disponibles.set(key, (disponibles.get(key) || 0) + 1);
        });
        const maxActual = cargas.length ? Math.max(...cargas) : null;
        const usados = new Map();
        return comp.filter(item => {
            const mw = num(item.mw);
            if (!Number.isFinite(mw)) return true;
            const key = mw.toFixed(3);
            const max = disponibles.get(key) || 0;
            if (!max) return Number.isFinite(maxActual) && mw > maxActual + 0.001;
            const actualCount = usados.get(key) || 0;
            if (actualCount >= max) return false;
            usados.set(key, actualCount + 1);
            return true;
        });
    }

    function prepararComparacionEnSlots(comp, actualPreparada) {
        const slots = new Map();
        const cargas = [];
        let siguienteX = 1;
        actualPreparada.forEach(item => {
            const mw = num(item.mw);
            if (!Number.isFinite(mw)) return;
            cargas.push(mw);
            siguienteX = Math.max(siguienteX, Math.ceil(Number(item._chartX) || 0) + 1);
            const key = mw.toFixed(3);
            if (!slots.has(key)) slots.set(key, []);
            slots.get(key).push(item._chartX);
        });
        const maxActual = cargas.length ? Math.max(...cargas) : null;
        const usados = new Map();
        return comp.map(item => {
            const mw = num(item.mw);
            if (!Number.isFinite(mw)) return null;
            const key = mw.toFixed(3);
            const list = slots.get(key) || [];
            const index = usados.get(key) || 0;
            if (!list[index]) {
                if (Number.isFinite(maxActual) && mw > maxActual + 0.001) return { ...item, _chartX: siguienteX++ };
                return null;
            }
            usados.set(key, index + 1);
            return { ...item, _chartX: list[index] };
        }).filter(Boolean);
    }

    function prepararComparacionTendencia(comp, actualPreparada) {
        const slots = new Map();
        const anclasMap = new Map();
        let siguienteX = 1;

        actualPreparada.forEach(item => {
            const mw = num(item.mw);
            const x = num(item._chartX);
            if (!Number.isFinite(mw) || !Number.isFinite(x)) return;
            const key = mw.toFixed(3);
            siguienteX = Math.max(siguienteX, Math.ceil(x) + 1);
            if (!slots.has(key)) slots.set(key, []);
            slots.get(key).push(x);
            const ancla = anclasMap.get(key) || { mw, firstX: x, lastX: x };
            ancla.firstX = Math.min(ancla.firstX, x);
            ancla.lastX = Math.max(ancla.lastX, x);
            anclasMap.set(key, ancla);
        });

        slots.forEach(list => list.sort((a, b) => a - b));
        const anclas = [...anclasMap.values()].sort((a, b) => a.mw - b.mw);
        const usadosSlots = new Map();
        const vistosIntermedios = new Set();

        return comp.map((item, index) => {
            const mw = num(item.mw);
            if (!Number.isFinite(mw)) return null;
            const key = mw.toFixed(3);
            const list = slots.get(key) || [];
            if (list.length) {
                const usado = usadosSlots.get(key) || 0;
                if (usado >= list.length) return null;
                usadosSlots.set(key, usado + 1);
                return { ...item, _chartX: list[usado], _chartIndex: index, _chartLabel: false };
            }

            const anterior = [...anclas].reverse().find(ancla => ancla.mw < mw - 0.001);
            const siguiente = anclas.find(ancla => ancla.mw > mw + 0.001);
            if (anterior && siguiente) {
                if (vistosIntermedios.has(key)) return null;
                vistosIntermedios.add(key);
                const rangoMw = siguiente.mw - anterior.mw || 1;
                const proporcion = Math.max(0.12, Math.min(0.88, (mw - anterior.mw) / rangoMw));
                const inicioX = anterior.lastX;
                const finX = siguiente.firstX;
                const x = inicioX + (finX - inicioX) * proporcion;
                return { ...item, _chartX: Number(x.toFixed(4)), _chartIndex: index, _chartLabel: false };
            }
            if (anterior && !siguiente) return { ...item, _chartX: siguienteX++, _chartIndex: index, _chartLabel: true };
            return null;
        }).filter(Boolean);
    }

    function punto(item, value) {
        const x = num(item._chartX);
        const y = num(value);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y, hora: item.hora || '', mw: item.mw || '', nota: item.nota || '', parametros: item.parametros || {} };
    }

    function labelCarga(item, index, mostrarHora) {
        const mw = String(item?.mw || '').trim();
        const hora = String(item?.hora || '').trim();
        const carga = mw ? `${mw.replace('.', ',')} MW` : `#${index + 1}`;
        return mostrarHora && hora ? [carga, hora] : carga;
    }

    function render() {
        const unidad = $('unidad-select').value;
        const comparar = $('comparar-select').value === unidad ? '' : $('comparar-select').value;
        $('comparar-select').value = comparar;
        const modo = $('modo-select').value;
        const mod = MOD_PUNTOS[moduloActivo];
        const modLabel = MOD_LABELS[moduloActivo];
        $('modulo-title').textContent = modLabel;

        const base = leerUnidad(unidad);
        const compRaw = comparar ? leerUnidad(comparar) : [];
        const compFiltrada = comparar
            ? (modo === 'mw-real' ? compRaw : limitarComparacionPorMw(compRaw, base))
            : [];
        const baseOrdenada = modo === 'mw-real' ? [...base].sort(ordenMw) : [...base];
        const compOrdenada = modo === 'mw-real' ? [...compFiltrada].sort(ordenMw) : [...compFiltrada];
        const baseGraf = modo === 'mw-real' ? prepararSecuencia(baseOrdenada, 0, 2) : prepararSecuencia(baseOrdenada, comparar ? -0.08 : 0);
        const compGraf = modo === 'mw-real' ? prepararComparacionTendencia(compOrdenada, baseGraf) : prepararSecuencia(compOrdenada, 0.08);
        const hayComp = !!comparar && compGraf.length > 0;

        const serie = (lista, getter) => lista.map(item => punto(item, getter(item))).filter(Boolean);
        const entrada = serie(baseGraf, item => item.entrada?.[mod.entrada]);
        const salida1 = serie(baseGraf, item => item.salida?.[mod.salida1]);
        const salida2 = serie(baseGraf, item => item.salida?.[mod.salida2]);
        const entradaComp = serie(compGraf, item => item.entrada?.[mod.entrada]);
        const salida1Comp = serie(compGraf, item => item.salida?.[mod.salida1]);
        const salida2Comp = serie(compGraf, item => item.salida?.[mod.salida2]);

        const temps = [...entrada, ...salida1, ...salida2, ...entradaComp, ...salida1Comp, ...salida2Comp].map(p => p.y);
        const etiquetas = new Map();
        const etiquetasFuente = modo === 'mw-real' ? [...baseGraf, ...compGraf.filter(item => item?._chartLabel)] : [...baseGraf, ...compGraf];
        etiquetasFuente.forEach((item, index) => {
            const x = Math.round(Number(item._chartX));
            if (Number.isFinite(x) && !etiquetas.has(x)) etiquetas.set(x, { item, index });
        });
        const xGraficos = [...baseGraf, ...compGraf].map(item => num(item._chartX)).filter(Number.isFinite);
        const total = Math.max(1, ...xGraficos, ...[...etiquetas.keys()]);
        const etiqueta = value => {
            const x = Math.round(Number(value));
            if (Math.abs(Number(value) - x) > 0.05 || !etiquetas.has(x)) return '';
            const entry = etiquetas.get(x);
            return labelCarga(entry.item, entry.index, modo !== 'mw-real' && !hayComp);
        };

        $('chart-sub').textContent = comparar
            ? `Módulo ${modLabel}: ${unidad} vs ${comparar} (${modo === 'mw-real' ? 'tendencia por MW' : 'Orden Medición'})`
            : `Módulo ${modLabel}: ${modo === 'mw-real' ? 'tendencia por MW' : 'Orden Medición'}.`;
        $('status').innerHTML = comparar
            ? `<i class="fa-solid fa-code-compare" style="color:#7c3aed;"></i> Comparando ${unidad} con ${comparar}.`
            : 'Selecciona otra unidad para comparar.';

        if (chart) chart.destroy();
        chart = new Chart($('tir-chart').getContext('2d'), {
            type: 'line',
            data: {
                datasets: [
                    ds(`${unidad} entrada ${modLabel}`, entrada, '#0f766e', false),
                    ds(`${unidad} salida ${modLabel}1`, salida1, '#dc2626', false),
                    ds(`${unidad} salida ${modLabel}2`, salida2, '#f97316', false),
                    ...(hayComp ? [
                        ds(`${comparar} entrada ${modLabel}`, entradaComp, '#0ea5e9', true),
                        ds(`${comparar} salida ${modLabel}1`, salida1Comp, '#ef4444', true),
                        ds(`${comparar} salida ${modLabel}2`, salida2Comp, '#b45309', true)
                    ] : [])
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                interaction: { mode: 'x', intersect: false },
                plugins: {
                    legend: { labels: { color: '#475569', usePointStyle: true, boxWidth: 10, font: { size: 13, weight: '700' } } },
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,.92)',
                        padding: 14,
                        bodySpacing: 7,
                        callbacks: {
                            title: items => items?.[0]?.raw?.hora ? `Hora ${items[0].raw.hora}` : 'Sin hora',
                            afterTitle: items => {
                                const item = items?.[0]?.raw || {};
                                const out = [];
                                if (item.mw) out.push(`${item.mw} MW${item.nota ? ` / ${item.nota}` : ''}`);
                                if (item.parametros?.vcampo) out.push(`V campo: ${item.parametros.vcampo} V`);
                                if (item.parametros?.icampo) out.push(`I campo: ${item.parametros.icampo} A`);
                                return out;
                            },
                            label: context => `${context.dataset.label}: ${fmt(context.parsed.y, 1)} C`
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'MW', color: '#64748b' },
                        ticks: { color: '#64748b', maxRotation: 45, minRotation: 45, stepSize: 1, callback: etiqueta },
                        grid: { color: 'rgba(226,232,240,.75)' },
                        min: 0,
                        suggestedMax: total + 1
                    },
                    y: {
                        title: { display: true, text: 'Temp C', color: '#64748b' },
                        ticks: { color: '#64748b', callback: value => `${fmt(value, 0)} C` },
                        grid: { color: 'rgba(226,232,240,.75)' },
                        suggestedMin: 0,
                        suggestedMax: Math.max(40, ...temps) + 5
                    }
                }
            }
        });
    }

    function ds(label, data, color, dashed) {
        return {
            label,
            data,
            borderColor: color,
            backgroundColor: 'rgba(255,255,255,.05)',
            borderDash: dashed ? [8, 5] : undefined,
            tension: 0.28,
            borderWidth: dashed ? 2.6 : 3,
            pointRadius: dashed ? 3.5 : 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#fff',
            pointBorderColor: color,
            pointBorderWidth: 2,
            spanGaps: true,
            yAxisID: 'y'
        };
    }

    async function refresh() {
        try {
            $('error').style.display = 'none';
            await cargarDatos();
            render();
            $('status').dataset.loadedAt = new Date().toISOString();
        } catch (error) {
            $('error').textContent = error.message || String(error);
            $('error').style.display = 'block';
        }
    }

    $('unidad-select').addEventListener('change', () => {
        if ($('comparar-select').value === $('unidad-select').value) $('comparar-select').value = '';
        render();
    });
    $('comparar-select').addEventListener('change', render);
    $('modo-select').addEventListener('change', render);
    $('refresh-btn').addEventListener('click', refresh);
    document.querySelectorAll('[data-modulo]').forEach(btn => {
        btn.addEventListener('click', () => {
            moduloActivo = btn.dataset.modulo || 'x';
            document.querySelectorAll('[data-modulo]').forEach(item => item.classList.toggle('active', item === btn));
            render();
        });
    });

    if (compartido) {
        const vista = compartido.vista || {};
        if (vista.unidad && [...$('unidad-select').options].some(o => o.value === vista.unidad)) $('unidad-select').value = vista.unidad;
        if (vista.comparar && [...$('comparar-select').options].some(o => o.value === vista.comparar)) $('comparar-select').value = vista.comparar;
        if (vista.modo && [...$('modo-select').options].some(o => o.value === vista.modo)) $('modo-select').value = vista.modo;
        if (vista.modulo && MOD_PUNTOS[vista.modulo]) {
            moduloActivo = vista.modulo;
            document.querySelectorAll('[data-modulo]').forEach(btn => btn.classList.toggle('active', btn.dataset.modulo === vista.modulo));
        }
        // Snapshot: no hay nada que refrescar contra el servidor.
        $('refresh-btn').style.display = 'none';
        const sub = document.querySelector('.sub');
        if (sub) sub.textContent = `Vista compartida solo lectura${compartido.generado ? ` · ${new Date(compartido.generado).toLocaleString('es-CL')}` : ''}.`;
    }

    refresh();
    if (!compartido) setInterval(refresh, 30000);
})();
