DO $$
DECLARE
    target_table text;
BEGIN
    IF to_regclass('public.mediciones') IS NOT NULL THEN
        target_table := 'public.mediciones';
    ELSIF to_regclass('public.historial_mediciones') IS NOT NULL THEN
        target_table := 'public.historial_mediciones';
    ELSE
        RAISE EXCEPTION 'No existe ni public.mediciones ni public.historial_mediciones';
    END IF;

    CREATE TEMP TABLE tmp_equipos_objetivo ON COMMIT DROP AS
    WITH objetivos(activo, componente, ubicacion) AS (
        VALUES
            ('Ventilador Tiro Forzado', 'Motor', 'Unidad 3'),
            ('Ventilador Tiro Forzado', 'Ventilador', 'Unidad 3'),
            ('Ventilador tiro inducido', 'Motor', 'Unidad 3'),
            ('Ventilador tiro inducido', 'Ventilador', 'Unidad 3'),
            ('Ventilador Aire Primario', 'Motor', 'Unidad 3'),
            ('Ventilador Recirculador de Gases', 'Motor', 'Unidad 3')
    )
    SELECT DISTINCT ON (e.activo, e.componente, e.ubicacion)
        e.id,
        e.activo,
        e.componente,
        e.ubicacion,
        e.kks,
        e.criticidad
    FROM public.equipos e
    INNER JOIN objetivos o
        ON o.activo = e.activo
       AND o.componente = e.componente
       AND o.ubicacion = e.ubicacion
    ORDER BY e.activo, e.componente, e.ubicacion, e.id;

    IF (SELECT COUNT(*) FROM tmp_equipos_objetivo) <> 6 THEN
        RAISE EXCEPTION 'Se esperaban 6 equipos objetivo y se encontraron %', (SELECT COUNT(*) FROM tmp_equipos_objetivo);
    END IF;

    CREATE TEMP TABLE tmp_mediciones_seed ON COMMIT DROP AS
    WITH equipos_base AS (
        SELECT
            teo.id AS equipo_id,
            teo.activo,
            teo.componente,
            teo.ubicacion,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 'Motor - lado acople'
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 'Ventilador - rodamiento DE'
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 'Motor - lado libre'
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 'Ventilador - rodamiento NDE'
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 'Motor - rodamiento principal'
                ELSE 'Motor - inspeccion general'
            END AS punto_medicion,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 'Brandon Mancilla'
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 'Luis Escudero'
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 'Vicente Navarrete'
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 'Diego Campillay'
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 'Brandon Mancilla'
                ELSE 'Luis Escudero'
            END AS tecnico_vibracion,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 'Ana Baez'
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 'Diego Campillay'
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 'Ana Baez'
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 'Luis Escudero'
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 'Ana Baez'
                ELSE 'Vicente Navarrete'
            END AS tecnico_termografia,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 2.8
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 2.2
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 3.5
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 3.1
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 2.4
                ELSE 2.7
            END AS base_vibracion,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 0.22
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 0.18
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 0.30
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 0.24
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 0.15
                ELSE 0.20
            END AS paso_vibracion,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 58
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 51
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 72
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 66
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 55
                ELSE 60
            END AS base_temperatura,
            CASE
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Motor' THEN 2.4
                WHEN teo.activo = 'Ventilador Tiro Forzado' AND teo.componente = 'Ventilador' THEN 1.8
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Motor' THEN 3.1
                WHEN teo.activo = 'Ventilador tiro inducido' AND teo.componente = 'Ventilador' THEN 2.7
                WHEN teo.activo = 'Ventilador Aire Primario' THEN 1.6
                ELSE 2.0
            END AS paso_temperatura
        FROM tmp_equipos_objetivo teo
    ),
    semanas AS (
        SELECT
            fecha_base::date AS fecha,
            ROW_NUMBER() OVER (ORDER BY fecha_base) - 1 AS idx
        FROM generate_series('2026-03-03'::date, '2026-03-31'::date, '7 days'::interval) AS gs(fecha_base)
    ),
    ajustes AS (
        SELECT
            idx,
            CASE idx
                WHEN 0 THEN 0.00
                WHEN 1 THEN 0.17
                WHEN 2 THEN -0.08
                WHEN 3 THEN 0.26
                ELSE 0.12
            END AS ajuste_vibracion,
            CASE idx
                WHEN 0 THEN 0
                WHEN 1 THEN 2
                WHEN 2 THEN -1
                WHEN 3 THEN 3
                ELSE 1
            END AS ajuste_temperatura
        FROM generate_series(0, 4) AS serie(idx)
    )
    SELECT
        eb.equipo_id,
        eb.activo,
        eb.componente,
        eb.ubicacion,
        eb.punto_medicion,
        'vibracion'::text AS tipo,
        round((eb.base_vibracion + (s.idx * eb.paso_vibracion) + a.ajuste_vibracion)::numeric, 2) AS valor,
        'mm/s'::text AS unidad,
        eb.tecnico_vibracion AS tecnico_nombre,
        (s.fecha::timestamp + time '09:00') AT TIME ZONE 'America/Santiago' AS fecha,
        format(
            'Seed marzo 2026. Tendencia semanal de vibracion para %s %s en %s.',
            eb.activo,
            eb.componente,
            eb.ubicacion
        ) AS observaciones
    FROM equipos_base eb
    CROSS JOIN semanas s
    INNER JOIN ajustes a ON a.idx = s.idx

    UNION ALL

    SELECT
        eb.equipo_id,
        eb.activo,
        eb.componente,
        eb.ubicacion,
        eb.punto_medicion,
        'termografia'::text AS tipo,
        round((eb.base_temperatura + (s.idx * eb.paso_temperatura) + a.ajuste_temperatura)::numeric, 1) AS valor,
        'C'::text AS unidad,
        eb.tecnico_termografia AS tecnico_nombre,
        (s.fecha::timestamp + time '14:30') AT TIME ZONE 'America/Santiago' AS fecha,
        format(
            'Seed marzo 2026. Perfil termografico semanal para %s %s en %s.',
            eb.activo,
            eb.componente,
            eb.ubicacion
        ) AS observaciones
    FROM equipos_base eb
    CROSS JOIN semanas s
    INNER JOIN ajustes a ON a.idx = s.idx;

    IF target_table = 'public.mediciones' THEN
        EXECUTE $sql$
            DELETE FROM public.mediciones m
            USING tmp_mediciones_seed s
            WHERE m.equipo_id = s.equipo_id::text
              AND m.tipo = s.tipo
              AND m.fecha = s.fecha;
        $sql$;

        EXECUTE $sql$
            INSERT INTO public.mediciones (
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
                NULL,
                s.tipo,
                s.valor,
                s.unidad,
                s.fecha,
                s.observaciones,
                s.componente,
                s.equipo_id::text,
                s.punto_medicion
            FROM tmp_mediciones_seed s
            ORDER BY s.fecha, s.activo, s.componente, s.tipo;
        $sql$;
    ELSE
        EXECUTE $sql$
            DELETE FROM public.historial_mediciones h
            USING tmp_mediciones_seed s
            WHERE h.equipo_id = s.equipo_id
              AND h.tipo = s.tipo
              AND h.fecha = s.fecha;
        $sql$;

        EXECUTE $sql$
            INSERT INTO public.historial_mediciones (
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
                s.equipo_id,
                s.tipo,
                s.valor,
                s.unidad,
                s.punto_medicion,
                s.observaciones,
                s.tecnico_nombre,
                s.fecha
            FROM tmp_mediciones_seed s
            ORDER BY s.fecha, s.activo, s.componente, s.tipo;
        $sql$;
    END IF;

    RAISE NOTICE 'Seed mensual aplicado en % con % registros.', target_table, (SELECT COUNT(*) FROM tmp_mediciones_seed);
END $$;
