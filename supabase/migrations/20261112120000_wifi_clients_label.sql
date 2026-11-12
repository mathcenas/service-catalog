-- Nombre puesto a mano desde el portal. Ni el script ni el importador lo tocan,
-- así sobrevive a cada sincronización (sirve para equipos con IP fija sin nombre).
ALTER TABLE wifi_clients ADD COLUMN IF NOT EXISTS label text;
