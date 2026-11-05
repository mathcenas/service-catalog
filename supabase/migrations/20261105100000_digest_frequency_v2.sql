-- Ampliar digest_frequency: agrega 'all' (diario, todo) y 'monthly'
-- Migra contactos con 'daily' → 'weekly'

ALTER TABLE client_contacts
  DROP CONSTRAINT IF EXISTS client_contacts_digest_frequency_check;

ALTER TABLE client_contacts
  ADD CONSTRAINT client_contacts_digest_frequency_check
  CHECK (digest_frequency IN ('none', 'weekly', 'monthly', 'all'));

-- Migrar daily → weekly (ya no existe como opción)
UPDATE client_contacts SET digest_frequency = 'weekly' WHERE digest_frequency = 'daily';
