/*
  # Add anon read policy for service_heartbeats

  1. Security Changes
    - Add SELECT policy on `service_heartbeats` for anon role
    - Only allows reading heartbeats for services belonging to clients that have an active share token
    - This enables the client portal to display speed test / heartbeat history

  2. Notes
    - Follows the same pattern used for support_hours anon access
    - No data modification allowed by anon, read-only
*/

CREATE POLICY "Anon can read heartbeats for shared clients"
  ON service_heartbeats FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM services s
      JOIN client_share_tokens t ON t.client_id = s.client_id
      WHERE s.id = service_heartbeats.service_id
    )
  );
