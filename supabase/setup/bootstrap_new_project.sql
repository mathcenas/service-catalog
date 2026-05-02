/*
  # Bootstrap a brand-new Supabase project for Client Manager

  Run this ONCE against a fresh Supabase project, from the SQL editor
  (Dashboard -> SQL -> New query -> paste -> Run).

  It applies all 4 migrations in order and creates the admin user
  mathias@cenas.uy with password ChangeMe123! (change it after first login).

  Safe to re-run: every statement uses IF EXISTS / IF NOT EXISTS / ON CONFLICT.
*/

-- ===== Migration 1: base schema =====================================

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text,
  address text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Pending')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_type_id uuid NOT NULL REFERENCES service_types(id),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Suspended','Cancelled','Pending')),
  price numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  billing_cycle text NOT NULL DEFAULT 'Monthly' CHECK (billing_cycle IN ('Monthly','Quarterly','Semi-Annually','Annually','Biennially','One-Time')),
  next_renewal_date date,
  provider text,
  server_ip text,
  specifications jsonb DEFAULT '{}'::jsonb,
  login_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_services_client ON services(client_id);
CREATE INDEX IF NOT EXISTS idx_services_user ON services(user_id);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner select clients" ON clients;
CREATE POLICY "Owner select clients" ON clients FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner insert clients" ON clients;
CREATE POLICY "Owner insert clients" ON clients FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner update clients" ON clients;
CREATE POLICY "Owner update clients" ON clients FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner delete clients" ON clients;
CREATE POLICY "Owner delete clients" ON clients FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner select services" ON services;
CREATE POLICY "Owner select services" ON services FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner insert services" ON services;
CREATE POLICY "Owner insert services" ON services FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner update services" ON services;
CREATE POLICY "Owner update services" ON services FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner delete services" ON services;
CREATE POLICY "Owner delete services" ON services FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can read service types" ON service_types;
CREATE POLICY "Anyone can read service types" ON service_types FOR SELECT TO authenticated USING (true);

INSERT INTO service_types (name, description, icon) VALUES
  ('VPS','Virtual Private Server','server'),
  ('Dedicated Server','Physical dedicated server','hard-drive'),
  ('Domain','Domain name registration','globe'),
  ('SSL Certificate','SSL/TLS Certificate','shield'),
  ('Email Hosting','Email hosting service','mail'),
  ('Web Hosting','Shared web hosting','cloud'),
  ('Backup','Backup service','database'),
  ('CDN','Content Delivery Network','zap'),
  ('Monitoring','Uptime / monitoring service','activity'),
  ('VPN','VPN / remote access','lock'),
  ('Firewall','Managed firewall','shield-check'),
  ('Managed Service','Fully managed service','briefcase')
ON CONFLICT (name) DO NOTHING;

-- ===== Migration 2: expand services + share tokens ==================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='infrastructure_type') THEN
    ALTER TABLE services ADD COLUMN infrastructure_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='cloud_provider') THEN
    ALTER TABLE services ADD COLUMN cloud_provider text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='cloud_account_payer') THEN
    ALTER TABLE services ADD COLUMN cloud_account_payer text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='confirmed_hours_monthly') THEN
    ALTER TABLE services ADD COLUMN confirmed_hours_monthly numeric(6,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='managed_roles') THEN
    ALTER TABLE services ADD COLUMN managed_roles jsonb DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='location') THEN
    ALTER TABLE services ADD COLUMN location text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='project_id') THEN
    ALTER TABLE services ADD COLUMN project_id uuid;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Completed','Cancelled')),
  start_date date,
  end_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner select projects" ON projects;
CREATE POLICY "Owner select projects" ON projects FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner insert projects" ON projects;
CREATE POLICY "Owner insert projects" ON projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner update projects" ON projects;
CREATE POLICY "Owner update projects" ON projects FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner delete projects" ON projects;
CREATE POLICY "Owner delete projects" ON projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS client_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),
  label text NOT NULL DEFAULT '',
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON client_share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_share_tokens_client ON client_share_tokens(client_id);

ALTER TABLE client_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner select tokens" ON client_share_tokens;
CREATE POLICY "Owner select tokens" ON client_share_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner insert tokens" ON client_share_tokens;
CREATE POLICY "Owner insert tokens" ON client_share_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner delete tokens" ON client_share_tokens;
CREATE POLICY "Owner delete tokens" ON client_share_tokens FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anon can read tokens by token" ON client_share_tokens;
CREATE POLICY "Anon can read tokens by token" ON client_share_tokens FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can read clients via share token" ON clients;
CREATE POLICY "Anon can read clients via share token" ON clients FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM client_share_tokens t WHERE t.client_id = clients.id));

DROP POLICY IF EXISTS "Anon can read services via share token" ON services;
CREATE POLICY "Anon can read services via share token" ON services FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM client_share_tokens t WHERE t.client_id = services.client_id));

DROP POLICY IF EXISTS "Anon can read projects via share token" ON projects;
CREATE POLICY "Anon can read projects via share token" ON projects FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM client_share_tokens t WHERE t.client_id = projects.client_id));

DROP POLICY IF EXISTS "Anon can read service types" ON service_types;
CREATE POLICY "Anon can read service types" ON service_types FOR SELECT TO anon USING (true);

-- ===== Migration 3: business fields + service_changes ===============

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
CREATE POLICY "Owners can select service_changes" ON service_changes FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owners can insert service_changes" ON service_changes;
CREATE POLICY "Owners can insert service_changes" ON service_changes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owners can update service_changes" ON service_changes;
CREATE POLICY "Owners can update service_changes" ON service_changes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owners can delete service_changes" ON service_changes;
CREATE POLICY "Owners can delete service_changes" ON service_changes FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anon can read service_changes via share token" ON service_changes;
CREATE POLICY "Anon can read service_changes via share token" ON service_changes FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM services s
      JOIN client_share_tokens t ON t.client_id = s.client_id
      WHERE s.id = service_changes.service_id
    )
  );

-- ===== Migration 4: Uptime Kuma fields ==============================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='uptime_badge_url') THEN
    ALTER TABLE services ADD COLUMN uptime_badge_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='uptime_status_url') THEN
    ALTER TABLE services ADD COLUMN uptime_status_url text;
  END IF;
END $$;

-- ===== Admin user ===================================================
-- Creates mathias@cenas.uy with password ChangeMe123! (rotate immediately).

INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  'mathias@cenas.uy',
  crypt('ChangeMe123!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"],"role":"owner"}'::jsonb,
  '{}'::jsonb,
  now(), now(), '', '', '', ''
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'mathias@cenas.uy'
);
