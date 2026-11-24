-- El portal pide expected_interval_hours (frecuencia del job, ej. política de Kopia) para no marcar
-- vencido un job semanal. Faltaba en los permisos por columna de 20261123110000.
GRANT SELECT (expected_interval_hours) ON public.service_backups TO anon;
