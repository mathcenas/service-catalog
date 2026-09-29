-- Tabla de control para rate limiting de notificaciones por email.
-- Registra el último envío por (service_id, event_type).
-- La lógica de cooldown se aplica en la edge function via upsert atómico.

CREATE TABLE IF NOT EXISTS notification_locks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   uuid        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  event_type   text        NOT NULL,   -- ej: 'backup_failed', 'backup_warning', 'kopia_failed'
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  send_count   integer     NOT NULL DEFAULT 1,  -- cuántas veces se envió en total
  suppressed_count integer NOT NULL DEFAULT 0,  -- cuántas veces se suprimió por cooldown
  CONSTRAINT notification_locks_pkey UNIQUE (service_id, event_type)
);

-- Sin RLS: solo accede el service role desde edge functions
ALTER TABLE notification_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON notification_locks
  USING (false);  -- bloquea acceso anon/authenticated; service role bypasea RLS

-- Índice para el lookup por service_id
CREATE INDEX IF NOT EXISTS notification_locks_service_idx ON notification_locks (service_id);

-- Función PL/pgSQL que intenta adquirir el lock de forma atómica.
-- Retorna TRUE si se puede enviar (cooldown expirado o primer envío).
-- Retorna FALSE si se debe suprimir (cooldown activo).
--
-- Usa INSERT ... ON CONFLICT DO UPDATE ... WHERE para garantizar atomicidad:
-- si dos llamadas concurrentes llegan, solo una gana el upsert.
CREATE OR REPLACE FUNCTION try_acquire_notification_lock(
  p_service_id   uuid,
  p_event_type   text,
  p_cooldown_min integer DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- Intentar insertar o actualizar SOLO si el cooldown expiró
  INSERT INTO notification_locks (service_id, event_type, last_sent_at, send_count)
  VALUES (p_service_id, p_event_type, now(), 1)
  ON CONFLICT (service_id, event_type) DO UPDATE
    SET last_sent_at  = now(),
        send_count    = notification_locks.send_count + 1
  WHERE notification_locks.last_sent_at < now() - (p_cooldown_min || ' minutes')::interval;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Si ROW_COUNT = 0: el cooldown sigue activo → registrar supresión y retornar false
  IF v_updated = 0 THEN
    UPDATE notification_locks
    SET suppressed_count = suppressed_count + 1
    WHERE service_id = p_service_id AND event_type = p_event_type;
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
