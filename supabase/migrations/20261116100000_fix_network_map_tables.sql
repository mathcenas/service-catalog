-- Repara las tablas del mapa de red en producción:
-- - net_edges nunca se creó (la migración 20261007100000 falló entera por eso),
--   así que los enlaces dibujados a mano no se guardaban.
-- - net_layout_overrides no tenía client_id (vista "Todos"), kind ni critical.
-- Idempotente: se puede correr de nuevo sin efecto.

-- 1. Enlaces dibujados a mano (por sitio, o por cliente en la vista "Todos")
CREATE TABLE IF NOT EXISTS net_edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid REFERENCES sites(id) ON DELETE CASCADE,
  client_id  uuid REFERENCES clients(id) ON DELETE CASCADE,
  -- Pueden ser servicios, nodos dibujados a mano o equipos descubiertos: sin FK
  source_id  uuid NOT NULL,
  target_id  uuid NOT NULL,
  label      text,
  edge_style jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (site_id IS NOT NULL OR client_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_net_edges_site ON net_edges (site_id);
CREATE INDEX IF NOT EXISTS idx_net_edges_client ON net_edges (client_id) WHERE site_id IS NULL;

ALTER TABLE net_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "net_edges: owner via site or client" ON net_edges;
CREATE POLICY "net_edges: owner via site or client" ON net_edges
  FOR ALL
  USING (
    site_id IN (SELECT s.id FROM sites s WHERE s.client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid())))
    OR client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    site_id IN (SELECT s.id FROM sites s WHERE s.client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid())))
    OR client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid()))
  );

-- 2. Posiciones: también por cliente (vista "Todos"), con ícono elegido y marca de crítico
ALTER TABLE net_layout_overrides ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE net_layout_overrides ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE net_layout_overrides ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false;
ALTER TABLE net_layout_overrides ALTER COLUMN site_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS net_layout_overrides_client_unique
  ON net_layout_overrides (device_id, client_id)
  WHERE site_id IS NULL AND client_id IS NOT NULL;

DROP POLICY IF EXISTS "net_layout: owner via site" ON net_layout_overrides;
DROP POLICY IF EXISTS "net_layout: owner via site or client" ON net_layout_overrides;
CREATE POLICY "net_layout: owner via site or client" ON net_layout_overrides
  FOR ALL
  USING (
    site_id IN (SELECT s.id FROM sites s WHERE s.client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid())))
    OR client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    site_id IN (SELECT s.id FROM sites s WHERE s.client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid())))
    OR client_id IN (SELECT id FROM clients WHERE user_id = (SELECT auth.uid()))
  );
