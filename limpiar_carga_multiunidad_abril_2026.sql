DO $$
BEGIN
    IF to_regclass('public.historial_tareas') IS NOT NULL THEN
        DELETE FROM public.historial_tareas
        WHERE tipo ILIKE 'Seed Abril 2026 - %'
           OR observaciones ILIKE 'Seed abril 2026 multiunidad%'
           OR ot_numero ILIKE 'OT-SEED-%'
           OR numero_aviso ILIKE 'AV-SEED-%';
    END IF;

    IF to_regclass('public.tareas_historial') IS NOT NULL THEN
        DELETE FROM public.tareas_historial
        WHERE tarea ILIKE 'Seed Abril 2026 - %'
           OR tipo ILIKE 'Seed Abril 2026 - %'
           OR descripcion ILIKE 'Seed abril 2026 multiunidad%'
           OR observaciones ILIKE 'Seed abril 2026 multiunidad%'
           OR ot_numero ILIKE 'OT-SEED-%'
           OR numero_aviso ILIKE 'AV-SEED-%';
    END IF;

    IF to_regclass('public.mediciones') IS NOT NULL THEN
        DELETE FROM public.mediciones
        WHERE notas ILIKE 'Seed abril 2026 multiunidad%';
    END IF;

    IF to_regclass('public.historial_mediciones') IS NOT NULL THEN
        DELETE FROM public.historial_mediciones
        WHERE observaciones ILIKE 'Seed abril 2026 multiunidad%';
    END IF;
END $$;
