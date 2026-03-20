-- Script para agregar soporte de Órdenes de Trabajo (OT) a las tareas
-- Por favor, cópialo y córrelo en el SQL Editor de Supabase.

-- Agregamos la columna ot_numero a la tabla tareas de tipo texto.
-- Por defecto las viejas o las creadas sin OT no tendrán valor (serán NULL)
ALTER TABLE tareas ADD COLUMN ot_numero TEXT;
