/*
  # Create client_licenses table

  1. New Tables
    - `client_licenses`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users) - Owner of the record
      - `client_id` (uuid, FK to clients) - Which client this license belongs to
      - `service_id` (uuid, nullable, FK to services) - Optional link to a specific service
      - `software_name` (text, NOT NULL) - Name of the software (e.g., Bitdefender Endpoint Security)
      - `license_key` (text, nullable) - License key or activation code (admin-only, never shown to client)
      - `quantity` (int, default 1) - Number of seats/licenses/cores
      - `quantity_label` (text, default 'Licenses') - Unit label (Users, Cores, Devices, Licenses)
      - `expiration_date` (date, nullable) - When the license expires (null = perpetual)
      - `billing_cycle` (text, default 'Annually') - Monthly, Annually, Perpetual
      - `cost` (numeric, nullable) - What you pay for it (admin info)
      - `notes` (text, nullable) - Internal notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `client_licenses`
    - Policy for authenticated users to manage their own licenses

  3. Notes
    - ISO 20000 Asset & Configuration Management compliance
    - Displayed on client portal as "Active Licenses & Subscriptions"
    - Renewal warnings shown when expiration_date < 30 days away
*/

CREATE TABLE IF NOT EXISTS client_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  software_name text NOT NULL,
  license_key text,
  quantity int NOT NULL DEFAULT 1,
  quantity_label text NOT NULL DEFAULT 'Licenses',
  expiration_date date,
  billing_cycle text NOT NULL DEFAULT 'Annually',
  cost numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own licenses"
  ON client_licenses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own licenses"
  ON client_licenses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own licenses"
  ON client_licenses FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own licenses"
  ON client_licenses FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_client_licenses_client_id ON client_licenses(client_id);
CREATE INDEX IF NOT EXISTS idx_client_licenses_user_id ON client_licenses(user_id);
