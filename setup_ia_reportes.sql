-- Ejecuta este script en el editor SQL de tu panel de Supabase

-- Añadir campos para comentarios cualitativos al finalizar el trabajo
ALTER TABLE public.historial_tareas
ADD COLUMN acciones_realizadas text NULL,
ADD COLUMN observaciones text NULL;
