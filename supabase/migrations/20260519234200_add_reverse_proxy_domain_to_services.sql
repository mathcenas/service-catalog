/*
  # Add reverse proxy domain field to services

  1. Modified Tables
    - `services`
      - `reverse_proxy_domain` (text, nullable) - The reverse proxy or public-facing domain for this service (e.g., "app.clientname.com")

  2. Notes
    - Used by admin to quickly see what domain maps to which server
    - Not shown on client portal unless explicitly desired
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'reverse_proxy_domain'
  ) THEN
    ALTER TABLE services ADD COLUMN reverse_proxy_domain text;
  END IF;
END $$;
