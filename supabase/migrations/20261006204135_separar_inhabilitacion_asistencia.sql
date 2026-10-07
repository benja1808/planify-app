-- Habilitación manual independiente de asistencia y ocupación.
-- Los false históricos son ambiguos: se conservan en disponible, sin inferir
-- vacaciones/licencia a partir de una salida de turno o ausencia de check-in.
ALTER TABLE public.trabajadores
  ADD COLUMN IF NOT EXISTS inhabilitado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inhabilitado_actualizado_en timestamptz,
  ADD COLUMN IF NOT EXISTS inhabilitado_por text;
COMMENT ON COLUMN public.trabajadores.inhabilitado IS 'Bloqueo manual para asignación. No se modifica al ingresar, salir o finalizar tareas.';
COMMENT ON COLUMN public.trabajadores.disponible IS 'Estado de asistencia/disponibilidad de jornada. No indica inhabilitación manual.';
