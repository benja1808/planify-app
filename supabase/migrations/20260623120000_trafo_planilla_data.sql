-- Datos capturados para la planilla de transformadores AT (EXC/EST/AUX/PPAL).
-- Se guardan como JSONB en el registro del historial para poder regenerar la
-- planilla desde cualquier dispositivo (no solo desde el que la capturó).

ALTER TABLE historial_tareas
    ADD COLUMN IF NOT EXISTS trafo_data JSONB;
