-- Alerta de backup para el operador: corre diario a las 10:00 UTC (07:00 Montevideo)
-- Solo envía si hay servicios con backup history que no reportaron en las últimas 26h

SELECT cron.schedule(
  'alert-backup-stale',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/alert-backup-stale',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
