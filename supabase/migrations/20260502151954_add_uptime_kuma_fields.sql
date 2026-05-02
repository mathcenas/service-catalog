/*
  # Add Uptime Kuma integration fields to services

  1. Changes to `services`
    - `uptime_badge_url` (text) — URL to an Uptime Kuma badge image
      (e.g., https://status.example.com/api/badge/1/status or /uptime/24)
    - `uptime_status_url` (text) — URL to the Uptime Kuma public status page
      for that monitor, used as a "View live status" link for the client

  Notes:
    - Both fields are optional; stored as plain text URLs.
    - No new tables, no RLS changes required (covered by existing services RLS).
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='uptime_badge_url') THEN
    ALTER TABLE services ADD COLUMN uptime_badge_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='uptime_status_url') THEN
    ALTER TABLE services ADD COLUMN uptime_status_url text;
  END IF;
END $$;
