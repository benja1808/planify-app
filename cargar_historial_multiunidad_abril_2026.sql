DO $$
DECLARE
    objetivos_esperados integer := 10;
BEGIN
    CREATE TEMP TABLE tmp_objetivos ON COMMIT DROP AS
    SELECT *
    FROM (
        VALUES
            ('1101', 'Unidad 1', 'Ventilador Aire Primario', 'Motor', 'Motor - rodamiento principal', 2.45::numeric, 0.15::numeric, 56.0::numeric, 1.7::numeric, 'Brandon Mancilla', 'Ana Baez', 1.6::numeric),
            ('1102', 'Unidad 1', 'Ventilador tiro inducido', 'Motor', 'Motor - lado libre', 3.20::numeric, 0.18::numeric, 64.0::numeric, 2.1::numeric, 'Vicente Navarrete', 'Luis Escudero', 1.9::numeric),
            ('1201', 'Unidad 2', 'Ventilador Tiro Forzado', 'Motor', 'Motor - lado acople', 2.75::numeric, 0.17::numeric, 59.0::numeric, 1.8::numeric, 'Brandon Mancilla', 'Diego Campillay', 1.7::numeric),
            ('1202', 'Unidad 2', 'Ventilador tiro inducido', 'Ventilador', 'Ventilador - rodamiento DE', 2.95::numeric, 0.16::numeric, 61.0::numeric, 1.9::numeric, 'Luis Escudero', 'Ana Baez', 1.8::numeric),
            ('1401', 'Unidad 4', 'Alimentador de Carbon 4A', 'Motor', 'Motor - inspeccion general', 2.10::numeric, 0.12::numeric, 49.0::numeric, 1.4::numeric, 'Luis Escudero', 'Diego Campillay', 1.4::numeric),
            ('1402', 'Unidad 4', 'Molino Pulverizador de Carbon 4A', 'Reductor', 'Reductor - carcasa', 2.80::numeric, 0.17::numeric, 57.0::numeric, 1.8::numeric, 'Vicente Navarrete', 'Brandon Mancilla', 1.9::numeric),
            ('1501', 'Unidad 5', 'Ventilador Tiro Forzado', 'Motor', 'Motor - lado acople', 2.90::numeric, 0.18::numeric, 60.0::numeric, 1.8::numeric, 'Brandon Mancilla', 'Ana Baez', 1.8::numeric),
            ('1502', 'Unidad 5', 'Ventilador Recirculador de Gases', 'Motor', 'Motor - inspeccion lateral', 3.10::numeric, 0.19::numeric, 63.0::numeric, 2.0::numeric, 'Vicente Navarrete', 'Luis Escudero', 1.9::numeric),
            ('1901', 'Pta.Agua', 'Bomba Agua Servicio A U1-2', 'Motor', 'Motor - lado acople', 2.00::numeric, 0.11::numeric, 47.0::numeric, 1.3::numeric, 'Luis Escudero', 'Ana Baez', 1.3::numeric),
            ('1902', 'Pta.Agua', 'Bomba Agua Servicio B U3-4', 'Bomba', 'Bomba - inspeccion general', 1.75::numeric, 0.09::numeric, 44.0::numeric, 1.2::numeric, 'Diego Campillay', 'Luis Escudero', 1.2::numeric)
    ) AS t(
        codigo,
        ubicacion,
        activo,
        componente,
        punto_medicion,
        base_vibracion,
        paso_vibracion,
        base_temperatura,
        paso_temperatura,
        tecnico_vibracion,
        tecnico_termografia,
        hh_base
    );

    CREATE TEMP TABLE tmp_equipos_objetivo ON COMMIT DROP AS
    SELECT DISTINCT ON (e.ubicacion, e.activo, e.componente)
        e.id AS equipo_id,
        o.codigo,
        o.ubicacion,
        o.activo,
        o.componente,
        o.punto_medicion,
        o.base_vibracion,
        o.paso_vibracion,
        o.base_temperatura,
        o.paso_temperatura,
        o.tecnico_vibracion,
        o.tecnico_termografia,
        o.hh_base,
        COALESCE(NULLIF(e.kks, ''), 'SIN KKS') AS kks,
        COALESCE(NULLIF(e.criticidad, ''), 'B') AS criticidad
    FROM tmp_objetivos o
    INNER JOIN public.equipos e
        ON e.ubicacion = o.ubicacion
       AND e.activo = o.activo
       AND e.componente = o.componente
    ORDER BY e.ubicacion, e.activo, e.componente, e.id;

    IF (SELECT COUNT(*) FROM tmp_equipos_objetivo) <> objetivos_esperados THEN
        RAISE EXCEPTION 'Se esperaban % equipos objetivo y se encontraron %.', objetivos_esperados, (SELECT COUNT(*) FROM tmp_equipos_objetivo);
    END IF;

    CREATE TEMP TABLE tmp_fechas ON COMMIT DROP AS
    SELECT *
    FROM (
        VALUES
            (DATE '2026-04-02', 0, '08:05', '09:00'),
            (DATE '2026-04-09', 1, '08:15', '09:12'),
            (DATE '2026-04-16', 2, '08:00', '09:08'),
            (DATE '2026-04-23', 3, '08:20', '09:18'),
            (DATE '2026-04-30', 4, '08:10', '09:10')
    ) AS t(fecha, idx, hora_asignacion, hora_termino);

    CREATE TEMP TABLE tmp_ajustes ON COMMIT DROP AS
    SELECT *
    FROM (
        VALUES
            (0, 0.00::numeric, 0.0::numeric),
            (1, 0.18::numeric, 2.0::numeric),
            (2, -0.07::numeric, -1.0::numeric),
            (3, 0.24::numeric, 3.0::numeric),
            (4, 0.10::numeric, 1.0::numeric)
    ) AS t(idx, ajuste_vibracion, ajuste_temperatura);

    CREATE TEMP TABLE tmp_historial_carga ON COMMIT DROP AS
    SELECT
        gen_random_uuid() AS id,
        e.codigo,
        e.equipo_id,
        e.ubicacion,
        e.activo,
        e.componente,
        e.kks,
        e.criticidad,
        f.fecha,
        f.idx,
        f.hora_asignacion,
        f.hora_termino,
        CASE
            WHEN f.idx % 2 = 0 THEN e.tecnico_vibracion
            ELSE e.tecnico_termografia
        END AS lider_nombre,
        ARRAY[
            CASE
                WHEN f.idx % 2 = 0 THEN e.tecnico_termografia
                ELSE e.tecnico_vibracion
            END
        ]::text[] AS ayudantes_nombres,
        format('[%s] %s (Vibraciones, Termografia)', e.ubicacion, e.activo) AS tipo,
        format('OT-%s-%s', to_char(f.fecha, 'MMDD'), e.codigo) AS ot_numero,
        format('AV-%s-%s', e.codigo, to_char(f.fecha, 'DD')) AS numero_aviso,
        round((e.hh_base + (f.idx * 0.10))::numeric, 1) AS hh_trabajo_num,
        to_char(round((e.hh_base + (f.idx * 0.10))::numeric, 1), 'FM999999990D0') AS hh_trabajo_text,
        'Medicion de vibraciones, Termografia' AS acciones_realizadas,
        format(
            'Inspeccion predictiva del periodo para %s. Componente revisado: %s. KKS: %s.',
            e.activo,
            e.componente,
            e.kks
        ) AS observaciones,
        CASE
            WHEN e.base_vibracion >= 3.0 OR e.base_temperatura >= 63
                THEN 'Activo con dispersion moderada. Conviene mantener seguimiento sobre la tendencia.'
            WHEN e.base_vibracion >= 2.5 OR e.base_temperatura >= 56
                THEN 'Condicion estable, con variacion normal para el periodo.'
            ELSE 'Activo dentro de banda esperada para la ruta programada.'
        END AS analisis,
        'Mantener seguimiento segun frecuencia del equipo y comparar contra la ruta anterior.' AS recomendacion_analista,
        (f.fecha::timestamp + time '10:00') AT TIME ZONE 'America/Santiago' AS created_at
    FROM tmp_equipos_objetivo e
    CROSS JOIN tmp_fechas f;

    CREATE TEMP TABLE tmp_mediciones_carga ON COMMIT DROP AS
    SELECT
        e.codigo,
        e.equipo_id,
        e.ubicacion,
        e.activo,
        e.componente,
        e.punto_medicion,
        'vibracion'::text AS tipo,
        round((e.base_vibracion + (f.idx * e.paso_vibracion) + a.ajuste_vibracion)::numeric, 2) AS valor,
        'mm/s'::text AS unidad,
        e.tecnico_vibracion AS tecnico_nombre,
        (f.fecha::timestamp + time '09:00') AT TIME ZONE 'America/Santiago' AS fecha,
        format(
            'Ruta semanal de condicion para %s. Punto: %s.',
            e.activo,
            e.punto_medicion
        ) AS observaciones
    FROM tmp_equipos_objetivo e
    CROSS JOIN tmp_fechas f
    INNER JOIN tmp_ajustes a
        ON a.idx = f.idx

    UNION ALL

    SELECT
        e.codigo,
        e.equipo_id,
        e.ubicacion,
        e.activo,
        e.componente,
        e.punto_medicion,
        'termografia'::text AS tipo,
        round((e.base_temperatura + (f.idx * e.paso_temperatura) + a.ajuste_temperatura)::numeric, 1) AS valor,
        'C'::text AS unidad,
        e.tecnico_termografia AS tecnico_nombre,
        (f.fecha::timestamp + time '14:30') AT TIME ZONE 'America/Santiago' AS fecha,
        format(
            'Ruta semanal de condicion para %s. Punto: %s.',
            e.activo,
            e.punto_medicion
        ) AS observaciones
    FROM tmp_equipos_objetivo e
    CROSS JOIN tmp_fechas f
    INNER JOIN tmp_ajustes a
        ON a.idx = f.idx;

    IF to_regclass('public.historial_tareas') IS NOT NULL THEN
        DELETE FROM public.historial_tareas
        WHERE ot_numero IN (SELECT ot_numero FROM tmp_historial_carga);

        INSERT INTO public.historial_tareas (
            id,
            tipo,
            lider_id,
            lider_nombre,
            ayudantes_ids,
            ayudantes_nombres,
            ot_numero,
            hora_asignacion,
            hora_termino,
            created_at,
            acciones_realizadas,
            observaciones,
            numero_aviso,
            hh_trabajo,
            recomendacion_analista,
            analisis
        )
        SELECT
            s.id,
            s.tipo,
            NULL::uuid,
            s.lider_nombre,
            NULL::uuid[],
            s.ayudantes_nombres,
            s.ot_numero,
            s.hora_asignacion,
            s.hora_termino,
            s.created_at,
            s.acciones_realizadas,
            s.observaciones,
            s.numero_aviso,
            s.hh_trabajo_text,
            s.recomendacion_analista,
            s.analisis
        FROM tmp_historial_carga s
        ORDER BY s.fecha, s.ubicacion, s.activo, s.componente;
    END IF;

    IF to_regclass('public.tareas_historial') IS NOT NULL THEN
        DELETE FROM public.tareas_historial
        WHERE ot_numero IN (SELECT ot_numero FROM tmp_historial_carga);

        INSERT INTO public.tareas_historial (
            id,
            user_id,
            tarea,
            descripcion,
            completada,
            fecha_creacion,
            fecha_completada,
            acciones_realizadas,
            analisis,
            accion_analista,
            ayudantes_nombres,
            hh_trabajo,
            hora_asignacion,
            hora_termino,
            lider_nombre,
            numero_aviso,
            tipo,
            observaciones,
            ot_numero,
            recomendacion_analista
        )
        SELECT
            s.id,
            NULL::uuid,
            s.tipo,
            s.observaciones,
            true,
            s.created_at,
            s.created_at,
            s.acciones_realizadas,
            s.analisis,
            s.recomendacion_analista,
            array_to_string(s.ayudantes_nombres, ', '),
            s.hh_trabajo_num,
            s.hora_asignacion,
            s.hora_termino,
            s.lider_nombre,
            s.numero_aviso,
            s.tipo,
            s.observaciones,
            s.ot_numero,
            s.recomendacion_analista
        FROM tmp_historial_carga s
        ORDER BY s.fecha, s.ubicacion, s.activo, s.componente;
    END IF;

    IF to_regclass('public.mediciones') IS NOT NULL THEN
        DELETE FROM public.mediciones m
        USING tmp_mediciones_carga s
        WHERE m.equipo_id = s.equipo_id::text
          AND m.tipo = s.tipo
          AND m.fecha = s.fecha;

        INSERT INTO public.mediciones (
            id,
            user_id,
            tipo,
            valor,
            unidad,
            fecha,
            notas,
            componente,
            equipo_id,
            punto_medicion
        )
        SELECT
            gen_random_uuid(),
            NULL::uuid,
            s.tipo,
            s.valor,
            s.unidad,
            s.fecha,
            s.observaciones,
            s.componente,
            s.equipo_id::text,
            s.punto_medicion
        FROM tmp_mediciones_carga s
        ORDER BY s.fecha, s.ubicacion, s.activo, s.componente, s.tipo;
    END IF;

    IF to_regclass('public.historial_mediciones') IS NOT NULL THEN
        DELETE FROM public.historial_mediciones h
        USING tmp_mediciones_carga s
        WHERE h.equipo_id = s.equipo_id
          AND h.tipo = s.tipo
          AND h.fecha = s.fecha;

        INSERT INTO public.historial_mediciones (
            id,
            equipo_id,
            tipo,
            valor,
            unidad,
            punto_medicion,
            observaciones,
            tecnico_nombre,
            fecha
        )
        SELECT
            gen_random_uuid(),
            s.equipo_id,
            s.tipo,
            s.valor,
            s.unidad,
            s.punto_medicion,
            s.observaciones,
            s.tecnico_nombre,
            s.fecha
        FROM tmp_mediciones_carga s
        ORDER BY s.fecha, s.ubicacion, s.activo, s.componente, s.tipo;
    END IF;

    RAISE NOTICE 'Carga multiunidad abril 2026 aplicada. Historial: %, Mediciones: %.',
        (SELECT COUNT(*) FROM tmp_historial_carga),
        (SELECT COUNT(*) FROM tmp_mediciones_carga);
END $$;
