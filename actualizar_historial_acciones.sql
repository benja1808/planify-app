-- Agrega las columnas faltantes en historial_tareas para que el cierre de tareas funcione
ALTER TABLE public.historial_tareas
ADD COLUMN IF NOT EXISTS acciones_realizadas TEXT NULL,
ADD COLUMN IF NOT EXISTS observaciones TEXT NULL;
