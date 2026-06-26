ALTER TABLE public.trabajadores
    ADD COLUMN IF NOT EXISTS asignado_termografia boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS asignado_vibraciones boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.trabajadores.asignado_termografia IS
    'Habilita el acceso y los avisos del modulo de Termografia para el trabajador.';

COMMENT ON COLUMN public.trabajadores.asignado_vibraciones IS
    'Habilita el acceso y los avisos del modulo de Vibraciones para el trabajador.';
