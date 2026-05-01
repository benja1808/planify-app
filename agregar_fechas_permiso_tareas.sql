-- Agrega columna `fecha_inicio_permiso` a `tareas` para guardar el dato de la
-- columna L del Excel (Fe.inic.extr): desde cuándo se puede ejecutar el trabajo.
-- La columna `fecha_expiracion` ya existe y se reutiliza para la columna M
-- del Excel (Fe.fin extre): hasta cuándo está vigente el permiso.
-- Ejecutar en el SQL Editor de Supabase.

ALTER TABLE tareas ADD COLUMN IF NOT EXISTS fecha_inicio_permiso DATE;
