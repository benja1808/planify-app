-- =====================================================================
-- MIGRACIÓN: Login por RUT+PIN y fecha de expiración en tareas
-- Ejecutar en el SQL Editor de Supabase
-- =====================================================================

-- 1. Agregar columnas RUT y PIN a trabajadores
ALTER TABLE public.trabajadores
  ADD COLUMN IF NOT EXISTS rut TEXT,
  ADD COLUMN IF NOT EXISTS pin_acceso TEXT;

-- 2. Agregar fecha de expiración a tareas semanales
ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS fecha_expiracion DATE;

-- 3. Asignar RUT y PINs por defecto a cada trabajador
--    ⚠️ IMPORTANTE: Cambiar los RUTs por los reales antes de usar en producción
--    Los PINs son de 4 dígitos (puedes cambiarlos)
UPDATE public.trabajadores SET rut = '17.234.567-8', pin_acceso = '1111' WHERE nombre ILIKE 'Vicente Navarrete%';
UPDATE public.trabajadores SET rut = '16.456.789-K', pin_acceso = '2222' WHERE nombre ILIKE 'Luis Escudero%';
UPDATE public.trabajadores SET rut = '15.678.901-3', pin_acceso = '3333' WHERE nombre ILIKE 'Diego Campillay%';
UPDATE public.trabajadores SET rut = '14.901.234-4', pin_acceso = '4444' WHERE nombre ILIKE 'Ana Baez%';
UPDATE public.trabajadores SET rut = '19.123.456-5', pin_acceso = '5555' WHERE nombre ILIKE 'Brandon Mancilla%';
UPDATE public.trabajadores SET rut = '18.345.678-6', pin_acceso = '6666' WHERE nombre ILIKE 'Oscar Aguilar%';
UPDATE public.trabajadores SET rut = '17.567.890-7', pin_acceso = '7777' WHERE nombre ILIKE 'Hernan Carmona%';

-- 4. Verificar que quedaron correctos
SELECT nombre, puesto, rut, pin_acceso FROM public.trabajadores ORDER BY nombre;
