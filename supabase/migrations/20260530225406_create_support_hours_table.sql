/*
  # Create support_hours table

  1. New Tables
    - `support_hours`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users) - the admin who logged the entry
      - `client_id` (uuid, FK to clients) - which client
      - `service_id` (uuid, FK to services, nullable) - optionally linked to a service
      - `work_date` (date, NOT NULL) - when the work was performed
      - `hours` (numeric, NOT NULL) - hours spent (supports decimals like 0.5)
      - `description` (text) - what was done
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `support_hours` table
    - Policy for authenticated users to manage their own entries
    - Policy for anon to read via active share tokens (matching existing pattern)
*/

CREATE TABLE IF NOT EXISTS support_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  hours numeric(5,2) NOT NULL DEFAULT 0,
  description text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE support_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own support hours"
  ON support_hours FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own support hours"
  ON support_hours FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own support hours"
  ON support_hours FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own support hours"
  ON support_hours FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anon can read support hours for shared clients"
  ON support_hours FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM client_share_tokens t
      WHERE t.client_id = support_hours.client_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_support_hours_client_id ON support_hours(client_id);
CREATE INDEX IF NOT EXISTS idx_support_hours_work_date ON support_hours(work_date);
