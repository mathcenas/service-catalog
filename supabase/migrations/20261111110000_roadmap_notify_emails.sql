-- Destinatarios elegidos por ítem del roadmap. NULL = default del cliente
-- (email principal + alternativo + CC), como antes.
ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS notify_emails text[];
