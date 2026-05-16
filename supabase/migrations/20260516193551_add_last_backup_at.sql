/*
  # Add last_backup_at to services

  1. Modified Tables
    - `services`
      - `last_backup_at` (timestamptz, nullable) - Timestamp of the last successful backup.
        Updated externally by Veeam + PowerShell automation script via Supabase API.
        Displayed on client portal as "Last backup: X hours/minutes ago".

  2. Notes
    - This field is NOT manually maintained -- it's written by an external automation.
    - Combined with uptime_badge_url (Kuma) and operational_status, this completes
      the automated health view: uptime + backup + status require zero manual input.
    - Only major incidents and changes (service_changes table) need manual logging.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'last_backup_at'
  ) THEN
    ALTER TABLE services ADD COLUMN last_backup_at timestamptz;
  END IF;
END $$;
