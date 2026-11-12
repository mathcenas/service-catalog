-- Dispositivos que se conectan al Wi-Fi de un MikroTik (mk-wifi-report.sh).
-- Una fila por router (servicio) y MAC: guarda primera y última vez vista,
-- así el reporte muestra también quién se conectó en los últimos días.
CREATE TABLE IF NOT EXISTS wifi_clients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   uuid        REFERENCES clients(id) ON DELETE CASCADE,
  service_id  uuid        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  mac         text        NOT NULL,
  ip          text,
  hostname    text,
  comment     text,
  ssid        text,
  interface   text,
  signal      integer,
  tx_rate     text,
  rx_rate     text,
  uptime      text,
  connected   boolean     NOT NULL DEFAULT true,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, mac)
);

CREATE INDEX IF NOT EXISTS idx_wifi_clients_service ON wifi_clients (service_id, last_seen DESC);

ALTER TABLE wifi_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all" ON wifi_clients;
CREATE POLICY "owner_all" ON wifi_clients
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
