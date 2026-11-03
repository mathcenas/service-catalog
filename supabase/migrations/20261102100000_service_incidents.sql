-- 1. Task tracker client mapping
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS task_tracker_id text;

-- 2. Service incidents
CREATE TABLE IF NOT EXISTS service_incidents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      uuid REFERENCES clients(id) ON DELETE SET NULL,
  service_id     uuid REFERENCES services(id) ON DELETE SET NULL,
  external_id    text,                      -- ID from source system (for upsert)
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'task_tracker', 'kuma')),
  type           text NOT NULL DEFAULT 'incident' CHECK (type IN ('incident', 'maintenance', 'change')),
  status         text NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  title          text NOT NULL,
  description    text,
  reported_by    text,
  notes          jsonb NOT NULL DEFAULT '[]',   -- [{note, author, timestamp}]
  started_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS service_incidents_external_id_source_user
  ON service_incidents (user_id, source, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE service_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON service_incidents
  FOR ALL USING (auth.uid() = user_id);

-- Anon read via share token (same pattern as other tables)
CREATE POLICY "anon_read_via_token" ON service_incidents
  FOR SELECT USING (
    client_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM client_share_tokens cst
      WHERE cst.client_id = service_incidents.client_id
        AND has_valid_share_token(service_incidents.client_id)
    )
  );

CREATE INDEX IF NOT EXISTS service_incidents_client_id_idx ON service_incidents (client_id);
CREATE INDEX IF NOT EXISTS service_incidents_status_idx ON service_incidents (status);
