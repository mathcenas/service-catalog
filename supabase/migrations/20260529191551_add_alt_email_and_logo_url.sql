/*
  # Add alternative email to clients and logo_url to user settings

  1. Modified Tables
    - `clients`
      - `alt_email` (text, nullable) - Secondary/alternative email for additional contacts

  2. New Tables
    - `user_settings`
      - `id` (uuid, PK)
      - `user_id` (uuid, FK to auth.users, unique)
      - `logo_url` (text, nullable) - URL to uploaded company logo
      - `company_name` (text, nullable) - Display name for admin/brand
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  3. Security
    - RLS on `user_settings` for authenticated users (own data only)

  4. Notes
    - alt_email allows clients with multiple owners to receive notifications at both addresses
    - logo_url stores the public URL for the uploaded logo to show on client portal and emails
*/

-- Add alt_email to clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'alt_email'
  ) THEN
    ALTER TABLE clients ADD COLUMN alt_email text;
  END IF;
END $$;

-- Create user_settings table for logo and branding
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url text,
  company_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_user_unique UNIQUE (user_id)
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow anon to read user_settings for share page logo display
CREATE POLICY "Anon can read user_settings for portal branding"
  ON user_settings FOR SELECT
  TO anon
  USING (true);

-- Create storage bucket for logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for logo uploads
CREATE POLICY "Authenticated users can upload logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Authenticated users can update own logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Authenticated users can delete own logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'logos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view logos"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'logos');
