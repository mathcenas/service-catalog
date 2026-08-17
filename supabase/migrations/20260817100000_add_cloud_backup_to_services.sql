ALTER TABLE services
  ADD COLUMN IF NOT EXISTS cloud_backup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cloud_backup_retention_days integer;
