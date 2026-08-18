ALTER TABLE services
  ADD COLUMN IF NOT EXISTS telemetry_enabled boolean NOT NULL DEFAULT true;
