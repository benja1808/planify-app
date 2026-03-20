-- Script para agregar nuevos trabajadores:
-- Cristian Olivares, Ana Poblete, Karla Pasten

INSERT INTO trabajadores (nombre, puesto, habilidades, disponible, ocupado) VALUES
('Cristian Olivares', 'Supervisor', ARRAY['Medición de vibraciones', 'Termografía', 'Medición de espesores', 'END (Tintas penetrantes)', 'Medición de dureza'], false, false),
('Ana Poblete', 'Prevencionista de riesgo', ARRAY[]::TEXT[], false, false),
('Karla Pasten', 'Administrativa', ARRAY[]::TEXT[], false, false);
