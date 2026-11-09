-- Frecuencia esperada de backup por servicio: horas sin backup antes de considerarlo atrasado.
--   NULL = diario (26 h, el comportamiento anterior)
--   0    = no controlar (servicio sin backup propio, dado de baja, etc.)
-- Lo usan alert-backup-stale, el panel Daily Ops del dashboard y el portal del cliente.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS backup_max_age_hours integer
  CHECK (backup_max_age_hours IS NULL OR backup_max_age_hours >= 0);
