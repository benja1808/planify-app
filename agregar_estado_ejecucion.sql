-- =====================================================================
-- MIGRACIÓN: Agregar columna estado_ejecucion a tareas
-- Ejecutar en el SQL Editor de Supabase
-- =====================================================================

ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS estado_ejecucion TEXT DEFAULT 'activo';

-- Verificar
SELECT id, tipo, estado_tarea, estado_ejecucion FROM public.tareas LIMIT 5;
