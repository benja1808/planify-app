-- Agrega columna `subtitulo` a la tabla `tareas` para guardar el dato
-- de la columna H del Excel (se muestra debajo del título en el plan semanal).
-- Ejecutar en el SQL Editor de Supabase.

ALTER TABLE tareas ADD COLUMN IF NOT EXISTS subtitulo TEXT;
