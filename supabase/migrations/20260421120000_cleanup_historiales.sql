-- Borrar historial de trabajos (mantener trabajadores e insumos)
DELETE FROM mediciones;
DELETE FROM horas_extra;
DELETE FROM tareas;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='historial_tareas') THEN
    EXECUTE 'DELETE FROM historial_tareas';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tareas_historial') THEN
    EXECUTE 'DELETE FROM tareas_historial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='historial_mediciones') THEN
    EXECUTE 'DELETE FROM historial_mediciones';
  END IF;
END $$;
