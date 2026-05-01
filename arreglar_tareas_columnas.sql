-- =====================================================================
-- MIGRACIÓN: Arreglar columnas faltantes en la tabla tareas
-- Ejecutar en el SQL Editor de Supabase
-- =====================================================================

ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS estado_ejecucion TEXT DEFAULT 'activo',
  ADD COLUMN IF NOT EXISTS fecha_expiracion DATE,
  ADD COLUMN IF NOT EXISTS fecha_inicio_permiso DATE,
  ADD COLUMN IF NOT EXISTS orden INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtitulo TEXT,
  ADD COLUMN IF NOT EXISTS ubicacion TEXT;

ALTER TABLE public.equipos
  ADD COLUMN IF NOT EXISTS ubicacion_original TEXT,
  ADD COLUMN IF NOT EXISTS ubicacion_tecnica_propuesta TEXT;

-- Forzar la actualización del caché de la API de Supabase (PostgREST)
NOTIFY pgrst, 'reload schema';

-- Verificar las tablas
SELECT id, tipo, estado_ejecucion, fecha_expiracion, fecha_inicio_permiso, orden, subtitulo, ubicacion FROM public.tareas LIMIT 1;
SELECT id, activo, ubicacion_original, ubicacion_tecnica_propuesta FROM public.equipos LIMIT 1;
