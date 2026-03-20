-- Script para agregar estado a las tareas
-- Por favor, cópialo y córrelo en el SQL Editor de Supabase.

-- 1. Agregamos la columna estado_tarea. Por defecto valdrá 'en_curso' para no romper lo que ya tienes.
ALTER TABLE tareas ADD COLUMN estado_tarea TEXT DEFAULT 'en_curso';

-- 2. (Opcional) Actualizamos cualquier tarea vieja que pudieras tener para asegurarnos de que tengan este estado.
UPDATE tareas SET estado_tarea = 'en_curso' WHERE estado_tarea IS NULL;
