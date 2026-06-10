-- MikroTik device telemetry time-series table
CREATE TABLE IF NOT EXISTS device_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  cpu_pct numeric(5,2),
  ram_used_mb numeric(12,2),
  ram_total_mb numeric(12,2),
  bandwidth_in_bps bigint,
  bandwidth_out_bps bigint,
  uptime_seconds bigint,
  firmware_version text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_telemetry_service_recorded
  ON device_telemetry (service_id, recorded_at DESC);

ALTER TABLE device_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_telemetry" ON device_telemetry FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_telemetry" ON device_telemetry FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_telemetry" ON device_telemetry FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own_telemetry" ON device_telemetry FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
