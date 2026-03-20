-- Ejecuta este script en el editor SQL de tu panel de Supabase

-- 1. Crear la tabla de historial de tareas terminadas
CREATE TABLE public.historial_tareas (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tipo text NULL,
  lider_id uuid NULL,
  lider_nombre text NULL,
  ayudantes_ids _uuid NULL,
  ayudantes_nombres _text NULL,
  ot_numero text NULL,
  hora_asignacion text NULL,
  hora_termino text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT historial_tareas_pkey PRIMARY KEY (id)
);

-- 2. Habilitar inserción anonima (Mismos permisos relajados que usamos antes)
ALTER TABLE public.historial_tareas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo a anon en historial_tareas" 
ON public.historial_tareas 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);
