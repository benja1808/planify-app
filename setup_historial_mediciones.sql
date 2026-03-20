-- 1. Crear tabla de Historial de Mediciones
CREATE TABLE public.historial_mediciones (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  equipo_id UUID REFERENCES public.equipos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- 'vibracion', 'termografia', 'lubricacion', 'aceite'
  valor NUMERIC,       -- mm/s para vibración, °C para termografía
  unidad TEXT,         -- 'mm/s', '°C', '-'
  punto_medicion TEXT, -- 'Lado Accionamiento (DA)', etc.
  observaciones TEXT,
  tecnico_nombre TEXT,
  fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Habilitar RLS y crear política para permitir todo el acceso (desarrollo)
ALTER TABLE public.historial_mediciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo en historial_mediciones" 
  ON public.historial_mediciones FOR ALL USING (true) WITH CHECK (true);

-- 3. Habilitar Tiempo Real (Realtime) para la tabla
alter publication supabase_realtime add table historial_mediciones;
