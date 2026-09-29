-- Requires pg_cron extension (already enabled in Supabase)
-- Runs daily at 11:00 UTC (08:00 America/Montevideo)
-- Daily contacts receive every day; weekly contacts only on Monday (checked inside the function)

SELECT cron.schedule(
  'client-digest-daily',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url    := current_setting('app.supabase_url') || '/functions/v1/client-weekly-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body   := '{}'::jsonb
  );
  $$
);
