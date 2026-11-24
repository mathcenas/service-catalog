-- Cada cuánto corre el job según la herramienta (kopia-report lo lee de la política de Kopia).
-- El portal lo usa para no marcar vencido un job semanal de un servicio diario.
ALTER TABLE service_backups ADD COLUMN IF NOT EXISTS expected_interval_hours numeric;
