-- Add priority_ports to device_telemetry (MikroTik per-port stats)
ALTER TABLE device_telemetry
  ADD COLUMN IF NOT EXISTS priority_ports jsonb;

-- Create device_events table for syslog events (IPsec, firewall, etc.)
CREATE TABLE IF NOT EXISTS device_events (
  id              bigserial PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id      uuid        NOT NULL REFERENCES services(id)   ON DELETE CASCADE,
  device_id       text,
  event_type      text        NOT NULL,
  status          text,
  source_ip       text,
  message         text,
  timestamp       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_events_service_id_idx  ON device_events(service_id);
CREATE INDEX IF NOT EXISTS device_events_timestamp_idx   ON device_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS device_events_event_type_idx  ON device_events(event_type);

ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own device events"
  ON device_events FOR SELECT
  USING (auth.uid() = user_id);
