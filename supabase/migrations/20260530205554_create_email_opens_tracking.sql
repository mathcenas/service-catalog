/*
  # Create email_opens tracking table

  1. New Tables
    - `email_opens`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users) - owner of the notification
      - `roadmap_item_id` (uuid, nullable) - linked roadmap item
      - `client_email` (text) - recipient
      - `opened_at` (timestamptz) - first open time
      - `open_count` (int) - total opens
      - `tracking_id` (uuid, unique) - used in tracking pixel URL
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Authenticated users can read their own tracking data
    - Service role inserts via edge function
*/

CREATE TABLE IF NOT EXISTS email_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  roadmap_item_id uuid,
  client_email text NOT NULL,
  tracking_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  opened_at timestamptz,
  open_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_opens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own email tracking data"
  ON email_opens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own email tracking data"
  ON email_opens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
