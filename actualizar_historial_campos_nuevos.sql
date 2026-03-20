-- Script para agregar nuevos campos al historial de tareas
-- Ejecuta este script en el editor SQL de Supabase

ALTER TABLE public.historial_tareas
ADD COLUMN IF NOT EXISTS numero_aviso TEXT NULL,
ADD COLUMN IF NOT EXISTS hh_trabajo TEXT NULL,
ADD COLUMN IF NOT EXISTS analisis TEXT NULL,
ADD COLUMN IF NOT EXISTS recomendacion_analista TEXT NULL;
