-- 1. Add type field to support_hours for incident tracking
ALTER TABLE support_hours
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'work' CHECK (type IN ('work', 'incident')),
  ADD COLUMN IF NOT EXISTS title text;

-- 2. Client apps (third-party applications per client)
CREATE TABLE IF NOT EXISTS client_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  vendor text,
  support_phone text,
  whatsapp_url text,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON client_apps
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "anon_read_via_token" ON client_apps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM client_share_tokens cst
      WHERE cst.client_id = client_apps.client_id
        AND has_valid_share_token(client_apps.client_id)
    )
  );

-- 3. Restore test fields on services
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS last_restore_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_restore_test_result text CHECK (last_restore_test_result IN ('success', 'failed', 'partial'));

-- 4. Weekly digest toggle on user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_digest_day int NOT NULL DEFAULT 1, -- 1=Monday
  ADD COLUMN IF NOT EXISTS weekly_digest_email text; -- if null, uses auth email
