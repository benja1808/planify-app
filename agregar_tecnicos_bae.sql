-- ============================================================================
-- Agregar técnicos (Diego Campillay y Ana Baez) a TODAS las mediciones de las
-- Bombas de Aceite de Emergencia (BAE), U1..U5.
-- Los técnicos se guardan dentro del campo `notas` como JSON: {"t":[...],"o":"","h":""}
--
-- Ejecutar en: Supabase Dashboard -> SQL Editor (corre como service_role,
-- así que NO lo bloquea el RLS).
-- ============================================================================

-- 1) Limpiar la fila de prueba creada al sondear permisos
DELETE FROM mediciones WHERE punto_medicion = '__TEST_PERM__';

-- 2) Agregar los técnicos a las mediciones BAE que NO tienen técnico (notas vacío)
UPDATE mediciones
SET notas = '{"t":["Diego Campillay","Ana Baez"],"o":"","h":""}'
WHERE equipo_id IN (
    'e805d2d4-483e-4cee-9dec-9754ef112c97', -- BAE U1
    '5f2a052d-4b92-4783-896c-5b39958f7fdc', -- BAE U2
    '71fc9c8a-58fb-4496-8376-14faa811c477', -- BAE U3
    'd4baa985-27f5-4901-bebf-73327f1a282a', -- BAE U4
    'aa077ece-5eeb-4336-8ac8-a5140fe9bab0'  -- BAE U5
)
AND notas IS NULL;

-- 3) (Opcional) Para las que YA tuvieran observaciones en notas y quieras
--    conservarlas, agregando solo los técnicos, usa esto en su lugar del paso 2:
-- UPDATE mediciones
-- SET notas = jsonb_set(
--       COALESCE(NULLIF(notas,'')::jsonb, '{"o":"","h":""}'::jsonb),
--       '{t}', '["Diego Campillay","Ana Baez"]'::jsonb, true
--     )::text
-- WHERE equipo_id IN ( ... mismos ids ... );

-- 4) Verificar
SELECT punto_medicion, tipo, fecha, notas
FROM mediciones
WHERE equipo_id IN (
    'e805d2d4-483e-4cee-9dec-9754ef112c97',
    '5f2a052d-4b92-4783-896c-5b39958f7fdc',
    '71fc9c8a-58fb-4496-8376-14faa811c477',
    'd4baa985-27f5-4901-bebf-73327f1a282a',
    'aa077ece-5eeb-4336-8ac8-a5140fe9bab0'
)
ORDER BY fecha DESC
LIMIT 10;
