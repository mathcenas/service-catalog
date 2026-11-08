-- license-reminder-daily usaba app.settings.supabase_url / app.settings.service_role_key,
-- que no existen en este proyecto: el job fallaba todos los días sin enviar nada.
-- Se reprograma con las mismas claves que el resto de los crons (app.*).
-- cron.schedule con el mismo nombre actualiza el job existente.
SELECT cron.schedule(
  'license-reminder-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/license-reminder',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
