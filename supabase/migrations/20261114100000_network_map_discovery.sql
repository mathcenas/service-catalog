-- Mapa de red con equipos descubiertos por el router (net-topology-report.rsc).
--
-- services.mac_address: un servicio cargado a mano "absorbe" al equipo descubierto
--   con su MAC (o su IP): en el mapa se ve un solo nodo, el del servicio.
-- net_devices.service_id: vínculo equipo descubierto → servicio (automático o a mano).
-- net_devices.map_visibility: 'auto' (el mapa decide: solo infraestructura),
--   'show' (mostrar siempre) o 'hide' (no mostrar).

ALTER TABLE services ADD COLUMN IF NOT EXISTS mac_address text;
CREATE INDEX IF NOT EXISTS idx_services_mac ON services (upper(mac_address)) WHERE mac_address IS NOT NULL;

ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE net_devices ADD COLUMN IF NOT EXISTS map_visibility text NOT NULL DEFAULT 'auto'
  CHECK (map_visibility IN ('auto', 'show', 'hide'));

-- net_layout_overrides.device_id guarda ids de servicios, de nodos dibujados a mano
-- y de equipos descubiertos: no puede tener FK a una sola tabla.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'net_layout_overrides' AND con.contype = 'f'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'device_id')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE net_layout_overrides DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
