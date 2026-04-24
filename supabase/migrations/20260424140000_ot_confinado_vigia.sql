-- Campos para "espacio confinado" + vigía en OT/tareas
ALTER TABLE tareas
    ADD COLUMN IF NOT EXISTS espacio_confinado boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS vigia_id uuid NULL REFERENCES trabajadores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS vigia_nombre text NULL;

CREATE INDEX IF NOT EXISTS idx_tareas_vigia_id ON tareas(vigia_id);

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tareas;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;
