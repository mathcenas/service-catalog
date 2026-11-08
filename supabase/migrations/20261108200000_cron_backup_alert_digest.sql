-- Resumen diario de backups por cliente (solo si hubo fallas o advertencias).
-- Ya existe en producción (creado desde el dashboard); cron.schedule con el mismo
-- nombre lo actualiza, así que esta migración es idempotente.
SELECT cron.schedule(
  'backup-alert-digest-daily',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/backup-alert-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
