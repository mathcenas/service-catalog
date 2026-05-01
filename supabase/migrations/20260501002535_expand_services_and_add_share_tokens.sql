/*
  # Expand Services & Add Share Tokens

  ## Changes

  ### 1. `services` table — new columns
  - `infrastructure_type` (text): 'Cloud' | 'Physical' | 'Managed Service'
  - `cloud_provider` (text): AWS, Azure, GCP, etc.
  - `cloud_account_payer` (text): who pays the cloud bill
  - `confirmed_hours_monthly` (numeric): confirmed monthly hours for billing
  - `managed_roles` (text[]): array of managed service roles (Active Directory, VPN, Backups, etc.)
  - `location` (text): datacenter or physical location

  ### 2. `client_share_tokens` table — new table
  Stores secure share tokens that clients can use to view a read-only dashboard
  - `id` (uuid, PK)
  - `user_id` (uuid, FK auth.users)
  - `client_id` (uuid, FK clients)
  - `token` (text, unique, random string)
  - `label` (text): optional label for the link
  - `expires_at` (timestamptz, optional)
  - `created_at` (timestamptz)

  ### 3. Security
  - RLS enabled on `client_share_tokens`
  - Owners can manage their own tokens
  - Public (anon) SELECT allowed on tokens — required for the share page to resolve the token
  - Public SELECT on `clients` and `services` scoped by valid token lookup (handled in app layer via service role or edge function approach — tokens are validated app-side)

  ## Notes
  - `managed_roles` is stored as jsonb for flexibility (array of strings)
  - The share token approach: anon users hit /share/:token, app queries `client_share_tokens` to resolve client_id, then fetches client+services — this is enforced by a permissive policy on share_tokens for anon reads only
*/

-- Add new columns to services
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'infrastructure_type') THEN
    ALTER TABLE services ADD COLUMN infrastructure_type text DEFAULT 'Cloud';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'cloud_provider') THEN
    ALTER TABLE services ADD COLUMN cloud_provider text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'cloud_account_payer') THEN
    ALTER TABLE services ADD COLUMN cloud_account_payer text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'confirmed_hours_monthly') THEN
    ALTER TABLE services ADD COLUMN confirmed_hours_monthly numeric(8,2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'managed_roles') THEN
    ALTER TABLE services ADD COLUMN managed_roles jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'location') THEN
    ALTER TABLE services ADD COLUMN location text;
  END IF;
END $$;

-- Create client_share_tokens table
CREATE TABLE IF NOT EXISTS client_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  token text UNIQUE NOT NULL,
  label text DEFAULT 'Client Dashboard',
  expires_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE client_share_tokens ENABLE ROW LEVEL SECURITY;

-- Owners can manage their own tokens
CREATE POLICY "Users can view own share tokens"
  ON client_share_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own share tokens"
  ON client_share_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own share tokens"
  ON client_share_tokens FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow anon to resolve tokens (needed for the public share page)
CREATE POLICY "Public can read tokens for share page"
  ON client_share_tokens FOR SELECT
  TO anon
  USING (expires_at IS NULL OR expires_at > now());

-- Allow anon to read clients via share token (app enforces client_id match)
CREATE POLICY "Public can read clients for share page"
  ON clients FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read services for share page
CREATE POLICY "Public can read services for share page"
  ON services FOR SELECT
  TO anon
  USING (true);

CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON client_share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_share_tokens_client_id ON client_share_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_share_tokens_user_id ON client_share_tokens(user_id);