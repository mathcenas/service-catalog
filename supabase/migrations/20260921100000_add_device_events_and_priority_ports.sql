-- Ensure device_telemetry exists (may not have been applied previously)
CREATE TABLE IF NOT EXISTS device_telemetry (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id       uuid        NOT NULL REFERENCES services(id)   ON DELETE CASCADE,
  hostname         text        NOT NULL,
  cpu_pct          numeric(5,2),
  ram_used_mb      numeric(12,2),
  ram_total_mb     numeric(12,2),
  bandwidth_in_bps bigint,
  bandwidth_out_bps bigint,
  uptime_seconds   bigint,
  firmware_version text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_telemetry_service_recorded
  ON device_telemetry(service_id, recorded_at DESC);

ALTER TABLE device_telemetry ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'device_telemetry' AND policyname = 'select_own_telemetry'
  ) THEN
    CREATE POLICY "select_own_telemetry" ON device_telemetry FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'device_telemetry' AND policyname = 'insert_own_telemetry'
  ) THEN
    CREATE POLICY "insert_own_telemetry" ON device_telemetry FOR INSERT
      TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Add columns from later migrations (idempotent)
ALTER TABLE device_telemetry
  ADD COLUMN IF NOT EXISTS ram_pct       numeric(5,2),
  ADD COLUMN IF NOT EXISTS ipsec_online  boolean,
  ADD COLUMN IF NOT EXISTS wan_in_mbps   numeric(10,3),
  ADD COLUMN IF NOT EXISTS priority_ports jsonb;

-- Create device_events table for syslog events (IPsec, firewall, etc.)
CREATE TABLE IF NOT EXISTS device_events (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid        NOT NULL REFERENCES services(id)   ON DELETE CASCADE,
  device_id  text,
  event_type text        NOT NULL,
  status     text,
  source_ip  text,
  message    text,
  timestamp  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_events_service_id_idx ON device_events(service_id);
CREATE INDEX IF NOT EXISTS device_events_timestamp_idx  ON device_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS device_events_event_type_idx ON device_events(event_type);

ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'device_events' AND policyname = 'Users see own device events'
  ) THEN
    CREATE POLICY "Users see own device events" ON device_events FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
