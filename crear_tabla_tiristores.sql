-- Tabla de mediciones de tiristores de excitatriz (U3/U4/U5)
-- Ejecutar en: Supabase Dashboard -> SQL Editor
--
-- La app sube sola los datos existentes (seed del PDF + lo guardado en cada
-- navegador) la primera vez que sincroniza contra la tabla vacia.

CREATE TABLE IF NOT EXISTS public.tiristores_mediciones (
    id TEXT PRIMARY KEY,
    unidad TEXT NOT NULL,
    hora TEXT DEFAULT '',
    mw TEXT DEFAULT '',
    nota TEXT DEFAULT '',
    entrada JSONB NOT NULL DEFAULT '{}'::jsonb,
    salida JSONB NOT NULL DEFAULT '{}'::jsonb,
    frente JSONB NOT NULL DEFAULT '{}'::jsonb,
    parametros JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tiristores_mediciones_unidad
    ON public.tiristores_mediciones (unidad);

-- La app escribe con la anon key (igual que el resto de las tablas), asi que
-- RLS debe quedar desactivado; si no, los INSERT/UPDATE/DELETE fallan.
ALTER TABLE public.tiristores_mediciones DISABLE ROW LEVEL SECURITY;
