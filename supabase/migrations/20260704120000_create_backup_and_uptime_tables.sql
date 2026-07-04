-- service_backups: history of Veeam backup jobs per service
CREATE TABLE IF NOT EXISTS service_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  job_name text,
  status text NOT NULL DEFAULT 'success', -- success | warning | failed
  size_bytes bigint,
  duration_seconds integer,
  details text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_backups_service_backed_up
  ON service_backups (service_id, backed_up_at DESC);

ALTER TABLE service_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_backups" ON service_backups FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_backups" ON service_backups FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_backups" ON service_backups FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- anon can read backups for services they have a valid share token for
CREATE POLICY "anon_read_backups_shared" ON service_backups FOR SELECT
  TO anon USING (
    has_valid_share_token((
      SELECT client_id FROM services WHERE id = service_backups.service_id LIMIT 1
    ))
  );

-- uptime_events: Uptime Kuma webhook events (down/up transitions)
CREATE TABLE IF NOT EXISTS uptime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  monitor_name text,
  monitor_url text,
  event_type text NOT NULL, -- 'down' | 'up' | 'degraded'
  message text,
  duration_seconds integer, -- for 'up' events: how long it was down
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uptime_events_service_occurred
  ON uptime_events (service_id, occurred_at DESC);

ALTER TABLE uptime_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_uptime_events" ON uptime_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_uptime_events" ON uptime_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_uptime_events" ON uptime_events FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "anon_read_uptime_events_shared" ON uptime_events FOR SELECT
  TO anon USING (
    has_valid_share_token((
      SELECT client_id FROM services WHERE id = uptime_events.service_id LIMIT 1
    ))
  );
