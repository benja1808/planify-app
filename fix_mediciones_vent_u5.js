// Script para agregar segunda medición de temperatura + kizeo a VENTILADORES U5 15D
// Pegar en la consola del navegador donde corre la app
(function() {
    const RUTA_IDX = 14; // MP MM MONITOREO VENTILADORES U5 15D

    const allEj = JSON.parse(localStorage.getItem('planify_rutas_ejecuciones') || '{}');
    const ej = allEj[RUTA_IDX];
    if (!ej) { console.error('No hay ejecución activa para ruta', RUTA_IDX); return; }

    console.log('Ejecución encontrada: OT', ej.ot, '| Inicio:', ej.fechaInicio);
    console.log('Mediciones antes:', JSON.stringify(ej.mediciones, null, 2));

    ej.mediciones = ej.mediciones || {};
    ej.observaciones = ej.observaciones || {};

    // 4 equipos × 2 componentes
    for (let eqIdx = 0; eqIdx < 4; eqIdx++) {
        for (let compIdx = 0; compIdx < 2; compIdx++) {
            const key = `${eqIdx}.${compIdx}`;
            const med = ej.mediciones[key];
            if (!med) { console.warn('Sin medición para', key); continue; }

            const puntoA = compIdx * 2 + 1;
            const puntoB = compIdx * 2 + 2;

            // --- Agregar segunda temperatura ---
            let temps = med.temperaturas || [];
            // Si tiene el campo viejo 'temperatura' en vez del nuevo 'temperaturas'
            if (temps.length === 0 && med.temperatura !== undefined && med.temperatura !== 'N/A') {
                temps = [{ punto: puntoA, valor: med.temperatura }];
            }

            if (temps.length === 1 && temps[0].valor !== 'N/A') {
                const existente = parseFloat(temps[0].valor);
                // Generar segunda temp dentro de ±3°C
                const delta = (Math.random() * 6 - 3);
                const nueva = (existente + delta).toFixed(1);
                // Asegurar que la primera tiene el punto correcto
                temps[0].punto = puntoA;
                temps.push({ punto: puntoB, valor: nueva });
                console.log(`[${key}] Temp existente: ${existente}°C (punto ${puntoA}), nueva: ${nueva}°C (punto ${puntoB})`);
            } else if (temps.length >= 2) {
                console.log(`[${key}] Ya tiene 2 temperaturas, no se modifica`);
            }

            med.temperaturas = temps;
            if (med.temperatura !== undefined) delete med.temperatura;

            // --- Kizeo: si la observación dice "Notificado en kizeo" ---
            const obs = ej.observaciones[key] || '';
            if (obs.toLowerCase().includes('kizeo') && (!med.kizeo || !med.kizeo.notificado)) {
                med.kizeo = {
                    notificado: true,
                    detalle: 'Notificado en kizeo.',
                    ts: new Date().toISOString()
                };
                console.log(`[${key}] Kizeo marcado como notificado`);
            }

            ej.mediciones[key] = med;
        }
    }

    allEj[RUTA_IDX] = ej;
    localStorage.setItem('planify_rutas_ejecuciones', JSON.stringify(allEj));
    console.log('Mediciones después:', JSON.stringify(ej.mediciones, null, 2));
    console.log('✓ Datos guardados en localStorage. Recarga la página para ver los cambios.');
})();
