-- 1. Tabla de Ubicaciones
CREATE TABLE public.ubicaciones (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabla de Equipos
CREATE TABLE public.equipos (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ubicacion_id UUID REFERENCES public.ubicaciones(id) ON DELETE RESTRICT,
    ruta TEXT,
    kks TEXT NOT NULL,
    ubicacion_original TEXT,
    activo TEXT NOT NULL,
    componente TEXT,
    ubicacion_tecnica_propuesta TEXT,
    denominacion_ut TEXT,
    criticidad TEXT,
    frecuencia_nueva TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Habilitar y luego deshabilitar RLS para que todos tengan acceso desde la app
ALTER TABLE public.ubicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo en ubicaciones" ON public.ubicaciones FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en equipos" ON public.equipos FOR ALL USING (true) WITH CHECK (true);
