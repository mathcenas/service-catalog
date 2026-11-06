-- Columna para guardar el id de la task creada en TaskTracker al abrir un incidente
ALTER TABLE service_incidents
  ADD COLUMN IF NOT EXISTS external_task_id text;
