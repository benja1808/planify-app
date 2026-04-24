-- Seed: 5 equipos "Caldera" (uno por unidad).
-- Idempotente: solo inserta si no existe ya un equipo con ese activo + ubicacion.
INSERT INTO equipos (id, activo, ubicacion, componente, kks, criticidad)
SELECT gen_random_uuid(), 'Caldera', u.ubic, '', '', 'ALTA'
FROM (VALUES
    ('Unidad 1'),
    ('Unidad 2'),
    ('Unidad 3'),
    ('Unidad 4'),
    ('Unidad 5')
) AS u(ubic)
WHERE NOT EXISTS (
    SELECT 1 FROM equipos e
    WHERE e.activo = 'Caldera' AND e.ubicacion = u.ubic
);
