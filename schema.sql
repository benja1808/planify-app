-- Script para inicializar la Base de Datos en Supabase
-- Por favor, copia todo este texto y pégalo en el "SQL Editor" de tu proyecto en Supabase, luego presiona "Run".

-- 1. Crear tabla de Trabajadores
CREATE TABLE trabajadores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    puesto TEXT NOT NULL,
    habilidades TEXT[] DEFAULT '{}',
    disponible BOOLEAN DEFAULT false,
    ocupado BOOLEAN DEFAULT false
);

-- 2. Crear tabla de Tareas
CREATE TABLE tareas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL,
    trabajador_id UUID REFERENCES trabajadores(id),
    trabajador_nombre TEXT NOT NULL,
    hora_asignacion TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Habilitar Tiempo Real (Realtime) para ambas tablas
alter publication supabase_realtime add table trabajadores;
alter publication supabase_realtime add table tareas;

-- 4. Insertar los trabajadores reales
INSERT INTO trabajadores (nombre, puesto, habilidades, disponible, ocupado) VALUES
('Vicente Navarrete', 'Inspector Predictivo', ARRAY['END (Tintas penetrantes)', 'Medición de vibraciones', 'Termografía', 'Medición de espesores'], false, false),
('Luis Escudero', 'Inspector Predictivo', ARRAY['END (Tintas penetrantes)', 'Medición de vibraciones', 'Termografía', 'Medición de espesores'], false, false),
('Diego Campillay', 'Ayudante Eléctrico', ARRAY['END (Tintas penetrantes)', 'Medición de vibraciones', 'Termografía', 'Medición de dureza'], false, false),
('Ana Baez', 'Eléctrico', ARRAY['Termografía'], false, false),
('Brandon Mancilla', 'Líder Predictivo', ARRAY['END (Tintas penetrantes)', 'Medición de vibraciones', 'Termografía', 'Medición de espesores', 'Medición de dureza'], false, false),
('Oscar Aguilar', 'Líder Lubricación', ARRAY['Lubricación', 'Cambios de aceite'], false, false),
('Hernan Carmona', 'Técnico Lubricación', ARRAY['Lubricación', 'Cambios de aceite'], false, false);
