-- Ampliar digest_frequency: agrega 'all' (diario, todo) y 'monthly'
-- Migra contactos con 'daily' → 'weekly'

-- 1. Migrar primero para no violar el constraint existente
UPDATE client_contacts SET digest_frequency = 'weekly' WHERE digest_frequency = 'daily';

-- 2. Ahora reemplazar el CHECK
ALTER TABLE client_contacts
  DROP CONSTRAINT IF EXISTS client_contacts_digest_frequency_check;

ALTER TABLE client_contacts
  ADD CONSTRAINT client_contacts_digest_frequency_check
  CHECK (digest_frequency IN ('none', 'weekly', 'monthly', 'all'));
