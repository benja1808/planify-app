-- Seguimiento VIB: periodos mensuales y equipos no monitoreados

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

DO $$ BEGIN
    ALTER TABLE seguimiento_vib_equipos
        ADD CONSTRAINT seguimiento_vib_equipos_estado_check
        CHECK (estado_actual IN ('PENDIENTE', 'MEDIDO', 'FUERA_SERVICIO', 'MANTENIMIENTO', 'INDISPONIBLE'))
        NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE seguimiento_vib_equipos
        VALIDATE CONSTRAINT seguimiento_vib_equipos_estado_check;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_periodos_fecha
    ON seguimiento_vib_periodos (fecha_carga DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_periodo
    ON seguimiento_vib_equipos (periodo_id);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_ruta
    ON seguimiento_vib_equipos (ruta);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_ubicacion
    ON seguimiento_vib_equipos (ubicacion);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_estado
    ON seguimiento_vib_equipos (estado_actual);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_criticidad
    ON seguimiento_vib_equipos (criticidad);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_activo
    ON seguimiento_vib_equipos (activo);

ALTER TABLE seguimiento_vib_periodos DISABLE ROW LEVEL SECURITY;
ALTER TABLE seguimiento_vib_equipos DISABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE seguimiento_vib_periodos;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE seguimiento_vib_equipos;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
