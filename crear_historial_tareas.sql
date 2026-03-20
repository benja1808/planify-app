-- =====================================================================
-- MIGRACIÓN: Crear tabla historial_tareas
-- Ejecutar en el SQL Editor de Supabase
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.historial_tareas (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    tipo                   TEXT,
    lider_nombre           TEXT,
    ayudantes_nombres      TEXT[],
    hora_asignacion        TEXT,
    hora_termino           TEXT,
    ot_numero              TEXT,
    numero_aviso           TEXT,
    hh_trabajo             TEXT,
    acciones_realizadas    TEXT,
    observaciones          TEXT,
    analisis               TEXT,
    recomendacion_analista TEXT
);

-- Habilitar RLS y permitir acceso total (anon key puede leer/escribir)
ALTER TABLE public.historial_tareas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'historial_tareas' AND policyname = 'Allow all historial'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow all historial" ON public.historial_tareas FOR ALL USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- Verificar
SELECT 'Tabla creada OK' AS resultado, COUNT(*) AS registros FROM public.historial_tareas;
