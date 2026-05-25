-- Módulo Avisos SAP: registro y seguimiento de avisos creados en SAP.
-- Ejecutar en SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS avisos_sap (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- Datos del Excel SAP
    fecha_notif DATE NOT NULL,
    indicador_abc TEXT,
    prioridad TEXT,
    clase_aviso TEXT,
    pto_trabajo TEXT,
    parada BOOLEAN DEFAULT false,
    nro_notificacion TEXT UNIQUE NOT NULL,
    orden TEXT,
    ubicacion_tecnica TEXT,
    descripcion_original TEXT,
    descripcion_mejorada TEXT,
    autor TEXT,
    fecha_creacion DATE,
    status_sistema TEXT,
    autor_aviso TEXT,
    status_usuario TEXT,
    -- Vinculación con maestro de equipos
    equipo_id UUID,
    -- Metadata
    importado_en TIMESTAMPTZ DEFAULT NOW(),
    creado_por UUID
);

CREATE INDEX IF NOT EXISTS idx_avisos_ubicacion ON avisos_sap(ubicacion_tecnica);
CREATE INDEX IF NOT EXISTS idx_avisos_fecha     ON avisos_sap(fecha_notif DESC);
CREATE INDEX IF NOT EXISTS idx_avisos_equipo    ON avisos_sap(equipo_id);
CREATE INDEX IF NOT EXISTS idx_avisos_status    ON avisos_sap(status_usuario);

-- RLS abierto para que la app pueda leer/escribir con la anon key
ALTER TABLE avisos_sap ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en avisos_sap" ON avisos_sap;
CREATE POLICY "Permitir todo en avisos_sap" ON avisos_sap FOR ALL USING (true) WITH CHECK (true);

-- Realtime (opcional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE avisos_sap';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

NOTIFY pgrst, 'reload schema';
