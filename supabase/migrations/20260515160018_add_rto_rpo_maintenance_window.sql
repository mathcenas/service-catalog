/*
  # Add RTO, RPO, and Maintenance Window fields to services

  1. Modified Tables
    - `services`
      - `rto` (text) - Recovery Time Objective, e.g. "4 hours", "30 minutes"
      - `rpo` (text) - Recovery Point Objective, e.g. "24 hours", "1 hour"
      - `maintenance_window` (text) - Scheduled maintenance window, e.g. "Sundays 02:00-04:00 UTC"

  2. Notes
    - These fields support ISO 20000 service sheets
    - RTO = maximum acceptable downtime after failure
    - RPO = maximum acceptable data loss measured in time
    - Maintenance window = when planned changes can occur without prior notice
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'rto'
  ) THEN
    ALTER TABLE services ADD COLUMN rto text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'rpo'
  ) THEN
    ALTER TABLE services ADD COLUMN rpo text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'maintenance_window'
  ) THEN
    ALTER TABLE services ADD COLUMN maintenance_window text;
  END IF;
END $$;
