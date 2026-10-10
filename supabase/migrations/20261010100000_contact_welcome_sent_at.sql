-- Agrega campo para trackear cuándo se envió el welcome a cada contacto
ALTER TABLE public.client_contacts
  ADD COLUMN IF NOT EXISTS welcome_sent_at timestamptz;
