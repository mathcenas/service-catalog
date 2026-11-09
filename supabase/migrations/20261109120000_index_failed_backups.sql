-- El panel "Para hoy" del dashboard busca backups fallidos de las últimas 48 h.
-- Índice parcial: solo las filas fallidas, que son pocas, ordenadas por fecha.
CREATE INDEX IF NOT EXISTS idx_service_backups_failed_recent
  ON service_backups (created_at DESC)
  WHERE status IN ('failed', 'error');
