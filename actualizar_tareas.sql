-- Script para actualizar la tabla de Tareas y permitir equipos de trabajo

-- 1. Renombrar las columnas actuales para que correspondan al Líder
ALTER TABLE tareas RENAME COLUMN trabajador_id TO lider_id;
ALTER TABLE tareas RENAME COLUMN trabajador_nombre TO lider_nombre;

-- 2. Agregar nuevas columnas para guardar a los ayudantes (arreglos de datos)
ALTER TABLE tareas ADD COLUMN ayudantes_ids     UUID[] DEFAULT '{}';
ALTER TABLE tareas ADD COLUMN ayudantes_nombres TEXT[] DEFAULT '{}';
