CREATE TABLE IF NOT EXISTS client_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL,
  role        text,                          -- ej: "Gerente", "IT", "Contabilidad"
  digest_frequency text NOT NULL DEFAULT 'none'
                CHECK (digest_frequency IN ('none', 'daily', 'weekly')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON client_contacts
  FOR ALL USING (user_id = auth.uid());

-- Migrar datos existentes de clients
INSERT INTO client_contacts (user_id, client_id, name, email, role, digest_frequency)
SELECT
  c.user_id,
  c.id,
  COALESCE(c.contact_name, 'Principal'),
  c.email,
  'Gerente',
  CASE WHEN c.digest_enabled THEN 'weekly' ELSE 'none' END
FROM clients c
WHERE c.email IS NOT NULL AND c.email <> ''
ON CONFLICT DO NOTHING;

INSERT INTO client_contacts (user_id, client_id, name, email, role, digest_frequency)
SELECT
  c.user_id,
  c.id,
  'Contacto alternativo',
  c.alt_email,
  'Operativo',
  'none'
FROM clients c
WHERE c.alt_email IS NOT NULL AND c.alt_email <> ''
ON CONFLICT DO NOTHING;
