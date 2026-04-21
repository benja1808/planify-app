-- Insumos / Solicitudes / Movimientos con campos extendidos
ALTER TABLE trabajadores
ADD COLUMN IF NOT EXISTS puede_aprobar_insumos BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS insumos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo INTEGER UNIQUE,
    nombre TEXT NOT NULL,
    marca TEXT,
    unidad TEXT NOT NULL DEFAULT 'UNI' CHECK (unidad IN ('UNI', 'PARES')),
    stock_actual INTEGER NOT NULL DEFAULT 0,
    stock_inicial INTEGER NOT NULL DEFAULT 0,
    stock_minimo INTEGER NOT NULL DEFAULT 0,
    categoria TEXT,
    ubicacion TEXT,
    observaciones TEXT,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE insumos ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS ubicacion TEXT;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS observaciones TEXT;

CREATE TABLE IF NOT EXISTS solicitudes_insumos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
    insumo_id UUID NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
    aprobado_por TEXT,
    fecha_solicitud TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    fecha_aprobacion TIMESTAMPTZ,
    observaciones TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insumo_id UUID NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('salida', 'entrada', 'ajuste')),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    referencia_id UUID,
    motivo TEXT,
    stock_antes INTEGER,
    stock_despues INTEGER,
    creado_por TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS stock_antes INTEGER;
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS stock_despues INTEGER;

CREATE INDEX IF NOT EXISTS idx_insumos_codigo ON insumos(codigo);
CREATE INDEX IF NOT EXISTS idx_insumos_activo ON insumos(activo);
CREATE INDEX IF NOT EXISTS idx_solicitudes_insumos_estado ON solicitudes_insumos(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_insumos_trabajador ON solicitudes_insumos(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_insumos_fecha ON solicitudes_insumos(fecha_solicitud DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_insumo ON movimientos_inventario(insumo_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_fecha ON movimientos_inventario(fecha DESC);

CREATE OR REPLACE FUNCTION procesar_aprobacion_solicitud_insumo()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado = 'aprobada' AND COALESCE(OLD.estado, 'pendiente') = 'pendiente' THEN
        UPDATE insumos
        SET stock_actual = COALESCE(stock_actual, 0) - COALESCE(NEW.cantidad, 0)
        WHERE id = NEW.insumo_id;

        IF NOT EXISTS (
            SELECT 1 FROM movimientos_inventario
            WHERE referencia_id = NEW.id AND tipo = 'salida'
        ) THEN
            INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, referencia_id, creado_por, fecha)
            VALUES (NEW.insumo_id, 'salida', NEW.cantidad, NEW.id, NEW.aprobado_por,
                    COALESCE(NEW.fecha_aprobacion, timezone('utc'::text, now())));
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_procesar_solicitud_insumo ON solicitudes_insumos;
CREATE TRIGGER trigger_procesar_solicitud_insumo
AFTER UPDATE ON solicitudes_insumos
FOR EACH ROW
EXECUTE FUNCTION procesar_aprobacion_solicitud_insumo();

ALTER TABLE insumos DISABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_insumos DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_inventario DISABLE ROW LEVEL SECURITY;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE insumos; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE solicitudes_insumos; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE movimientos_inventario; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
