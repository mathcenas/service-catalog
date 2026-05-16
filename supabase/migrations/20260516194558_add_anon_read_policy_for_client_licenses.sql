/*
  # Allow anon read access to client_licenses for share page

  1. Security Changes
    - Add SELECT policy for `anon` role on `client_licenses`
    - Required for the public share page to display licenses/subscriptions
    - App enforces client_id filtering via the share token resolution

  2. Notes
    - Same pattern as clients, services, service_changes tables
    - The share page resolves a token -> client_id, then queries only that client's data
    - license_key field is intentionally NOT selected by the share page query
*/

CREATE POLICY "Anon can read licenses for share page"
  ON client_licenses FOR SELECT
  TO anon
  USING (true);
