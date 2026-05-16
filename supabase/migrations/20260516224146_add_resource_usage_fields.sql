/*
  # Add resource usage fields to services

  1. Modified Tables
    - `services`
      - `storage_used_pct` (numeric, nullable) - Monthly average storage usage percentage (0-100)
      - `ram_used_pct` (numeric, nullable) - Monthly average RAM usage percentage (0-100)
      - `resource_updated_at` (timestamptz, nullable) - When the resource metrics were last pushed

  2. Notes
    - Updated externally by monitoring scripts (PowerShell/Kuma/Zabbix)
    - Displayed on client portal as compact health bars per service
    - Thresholds: green <80%, amber 80-89%, red 90%+
    - No historical data stored -- just the current monthly average
    - Supports the "zero manual effort" philosophy alongside last_backup_at and uptime badges
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'storage_used_pct'
  ) THEN
    ALTER TABLE services ADD COLUMN storage_used_pct numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'ram_used_pct'
  ) THEN
    ALTER TABLE services ADD COLUMN ram_used_pct numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'resource_updated_at'
  ) THEN
    ALTER TABLE services ADD COLUMN resource_updated_at timestamptz;
  END IF;
END $$;
