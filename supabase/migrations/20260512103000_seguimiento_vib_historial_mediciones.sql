-- Vinculo entre Seguimiento VIB, historial y lecturas capturadas desde el modulo.

ALTER TABLE seguimiento_vib_equipos
    ADD COLUMN IF NOT EXISTS historial_id UUID,
    ADD COLUMN IF NOT EXISTS historial_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS medicion_fecha DATE,
    ADD COLUMN IF NOT EXISTS medicion_detalle JSONB DEFAULT '{}'::jsonb;

ALTER TABLE historial_tareas
    ADD COLUMN IF NOT EXISTS equipo_id UUID REFERENCES equipos(id),
    ADD COLUMN IF NOT EXISTS seguimiento_vib_equipo_id UUID REFERENCES seguimiento_vib_equipos(id),
    ADD COLUMN IF NOT EXISTS fecha_med DATE;

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_historial
    ON seguimiento_vib_equipos (historial_id);

CREATE INDEX IF NOT EXISTS idx_seguimiento_vib_equipos_medicion_fecha
    ON seguimiento_vib_equipos (medicion_fecha);

CREATE INDEX IF NOT EXISTS idx_historial_tareas_seguimiento_vib
    ON historial_tareas (seguimiento_vib_equipo_id);

CREATE INDEX IF NOT EXISTS idx_historial_tareas_fecha_med
    ON historial_tareas (fecha_med);
