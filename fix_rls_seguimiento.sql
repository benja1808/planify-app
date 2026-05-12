-- ============================================================
-- FIX: Deshabilitar RLS en tablas de seguimiento VIB
-- Causa del error: "new row violates row-level security policy 
--                   for table seguimiento_vib_periodos"
-- 
-- Pegar en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- 1. Asegurar que las tablas existen (idempotente)
CREATE TABLE IF NOT EXISTS seguimiento_vib_periodos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT NOT NULL,
    fecha_carga DATE DEFAULT CURRENT_DATE,
    archivo_origen TEXT,
    total_equipos INT DEFAULT 0,
    creado_por UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seguimiento_vib_equipos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    periodo_id UUID REFERENCES seguimiento_vib_periodos(id) ON DELETE CASCADE,
    dias_transcurridos INT,
    plan TEXT,
    cant_intentos INT,
    fecha_ultimo_intento DATE,
    observacion_original TEXT,
    ruta TEXT,
    ubicacion TEXT,
    activo TEXT,
    componente TEXT,
    ubicacion_tecnica TEXT,
    criticidad TEXT,
    razon TEXT,
    estado_actual TEXT DEFAULT 'PENDIENTE',
    observacion_planify TEXT,
    actualizado_por UUID REFERENCES auth.users(id),
    actualizado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Deshabilitar RLS (esto soluciona el error de importación)
ALTER TABLE seguimiento_vib_periodos DISABLE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_vib_equipos DISABLE ROW LEVEL SECURITY;

-- 3. Confirmar
SELECT 
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename IN ('seguimiento_vib_periodos', 'seguimiento_vib_equipos');
