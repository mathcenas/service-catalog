-- NAS SMB ACL snapshots — one row per script run per service
CREATE TABLE IF NOT EXISTS service_acl_snapshots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id   uuid        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  snapshot     jsonb       NOT NULL,          -- full share/user/permission payload
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acl_snapshots_service ON service_acl_snapshots (service_id, generated_at DESC);

ALTER TABLE service_acl_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON service_acl_snapshots
  FOR ALL USING (auth.uid() = user_id);
