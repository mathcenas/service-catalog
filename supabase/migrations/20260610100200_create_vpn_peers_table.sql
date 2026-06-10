-- VPN peers status table (IPSec + WireGuard)
CREATE TABLE IF NOT EXISTS vpn_peers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  peer_name text NOT NULL,
  tunnel_type text NOT NULL CHECK (tunnel_type IN ('ipsec', 'wireguard')),
  remote_address text,
  local_address text,
  status text NOT NULL DEFAULT 'unknown',
  last_handshake_at timestamptz,
  rx_bytes bigint DEFAULT 0,
  tx_bytes bigint DEFAULT 0,
  uptime_seconds bigint,
  comment text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vpn_peers_service_recorded
  ON vpn_peers (service_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vpn_peers_tunnel_type
  ON vpn_peers (tunnel_type, status);

ALTER TABLE vpn_peers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_vpn_peers" ON vpn_peers FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "insert_own_vpn_peers" ON vpn_peers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own_vpn_peers" ON vpn_peers FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own_vpn_peers" ON vpn_peers FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
