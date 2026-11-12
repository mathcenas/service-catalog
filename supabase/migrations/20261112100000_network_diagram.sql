-- Diagrama de red estilo plano: tipo de equipo por nodo, nodos dibujados a mano
-- (nube de Internet/ISP, equipos sin servicio) y puertos en los enlaces.

-- Tipo de ícono elegido a mano para un servicio (NULL = se adivina por tipo/nombre)
ALTER TABLE net_layout_overrides ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE net_layout_overrides ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false;

-- Nodos que no son servicios del catálogo
CREATE TABLE IF NOT EXISTS net_custom_nodes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id    uuid        REFERENCES sites(id) ON DELETE CASCADE,
  kind       text        NOT NULL DEFAULT 'internet',
  label      text        NOT NULL,
  ip         text,
  note       text,
  x          double precision NOT NULL DEFAULT 0,
  y          double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_net_custom_nodes_client ON net_custom_nodes (client_id, site_id);

ALTER TABLE net_custom_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all" ON net_custom_nodes;
CREATE POLICY "owner_all" ON net_custom_nodes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = client_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = client_id AND c.user_id = auth.uid()));

-- Los enlaces ahora pueden unir un servicio con un nodo dibujado a mano:
-- quitar las FK de net_edges.source_id / target_id hacia services, si existen.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'net_edges'
      AND con.contype = 'f'
      AND con.confrelid = 'services'::regclass
  LOOP
    EXECUTE format('ALTER TABLE net_edges DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
