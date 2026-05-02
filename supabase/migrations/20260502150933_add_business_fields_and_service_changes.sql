/*
  # Add ISO 20000 business fields + service change history

  1. Changes to `services`
    - `business_name` (text) — customer-facing service name (e.g., "Data Continuity")
    - `business_description` (text) — customer-facing description of the business value
    - `sla_level` (text) — short SLA text shown to client (e.g., "99.9% Recoverability")
    - `includes` (jsonb array of text) — what's included in the service
    - `excludes` (jsonb array of text) — what's NOT included (prevents scope creep)
    - `client_responsibilities` (jsonb array of text) — what the client must do
    - `operational_status` (text) — Operational | Maintenance | Degraded | Down, defaults 'Operational'

  2. New table `service_changes`
    - Historical record of changes made to a service (ITIL change log)
    - `id`, `user_id`, `service_id`, `change_date`, `summary`, `details`, `created_at`

  3. Security
    - RLS enabled on `service_changes`
    - Owners (auth.uid() = user_id) have full CRUD
    - `anon` can SELECT service_changes linked to a client with an active share token
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='business_name') THEN
    ALTER TABLE services ADD COLUMN business_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='business_description') THEN
    ALTER TABLE services ADD COLUMN business_description text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='sla_level') THEN
    ALTER TABLE services ADD COLUMN sla_level text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='includes') THEN
    ALTER TABLE services ADD COLUMN includes jsonb DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='excludes') THEN
    ALTER TABLE services ADD COLUMN excludes jsonb DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='client_responsibilities') THEN
    ALTER TABLE services ADD COLUMN client_responsibilities jsonb DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='operational_status') THEN
    ALTER TABLE services ADD COLUMN operational_status text DEFAULT 'Operational';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  change_date date NOT NULL DEFAULT CURRENT_DATE,
  summary text NOT NULL,
  details text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_changes_service ON service_changes(service_id);
CREATE INDEX IF NOT EXISTS idx_service_changes_user ON service_changes(user_id);

ALTER TABLE service_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can select service_changes" ON service_changes;
CREATE POLICY "Owners can select service_changes"
  ON service_changes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can insert service_changes" ON service_changes;
CREATE POLICY "Owners can insert service_changes"
  ON service_changes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can update service_changes" ON service_changes;
CREATE POLICY "Owners can update service_changes"
  ON service_changes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can delete service_changes" ON service_changes;
CREATE POLICY "Owners can delete service_changes"
  ON service_changes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anon can read service_changes via share token" ON service_changes;
CREATE POLICY "Anon can read service_changes via share token"
  ON service_changes FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM services s
      JOIN client_share_tokens t ON t.client_id = s.client_id
      WHERE s.id = service_changes.service_id
    )
  );
