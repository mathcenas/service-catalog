-- Inventario de equipos reportado por device-report.ps1 (una fila por equipo y cliente).
-- Reemplaza el CSV compartido: cada equipo hace upsert de su propia fila al iniciar sesión.
CREATE TABLE IF NOT EXISTS device_reports (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id    uuid        REFERENCES services(id) ON DELETE SET NULL,
  hostname      text        NOT NULL,
  ip            text,
  local_user    text,
  m365_user     text,
  nas_user      text,
  os            text,
  office        text,
  has_copilot   boolean     NOT NULL DEFAULT false,
  hardware      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  script_version text,
  reported_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, hostname)
);

CREATE INDEX IF NOT EXISTS idx_device_reports_user ON device_reports (user_id, client_id);

ALTER TABLE device_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all" ON device_reports;
CREATE POLICY "owner_all" ON device_reports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
