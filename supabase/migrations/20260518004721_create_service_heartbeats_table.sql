/*
  # Create service heartbeats table

  1. New Tables
    - `service_heartbeats`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users) - Owner of the service
      - `service_id` (uuid, FK to services) - Which service sent this heartbeat
      - `source` (text) - Script/source identifier (e.g., "veeam-backup", "resource-monitor", "uptime-push")
      - `payload` (jsonb) - The raw JSON data sent by the PowerShell/monitoring script
      - `status` (text) - Quick status: "ok", "warning", "error"
      - `message` (text, nullable) - Optional human-readable summary
      - `received_at` (timestamptz) - When the heartbeat was received

  2. Security
    - RLS enabled
    - Owner can read their own heartbeats
    - Authenticated users can insert heartbeats for their own services

  3. Notes
    - Designed for PowerShell scripts to POST JSON payloads (backup status, resource usage, etc.)
    - Admin dashboard shows latest heartbeats per service to detect stale/missing data
    - No client-facing visibility -- this is internal IT ops monitoring
*/

CREATE TABLE IF NOT EXISTS service_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ok',
  message text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_service_received
  ON service_heartbeats(service_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_heartbeats_user_received
  ON service_heartbeats(user_id, received_at DESC);

ALTER TABLE service_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own heartbeats"
  ON service_heartbeats
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owner can insert heartbeats"
  ON service_heartbeats
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner can delete own heartbeats"
  ON service_heartbeats
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
