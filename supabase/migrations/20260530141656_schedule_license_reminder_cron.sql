/*
  # Enable pg_cron and pg_net, schedule daily license reminder

  1. Extensions Enabled
    - `pg_cron` - Job scheduler for PostgreSQL
    - `pg_net` - Async HTTP client for calling edge functions

  2. Scheduled Job
    - `license-reminder-daily` - Runs every day at 08:00 UTC
    - Calls the `license-reminder` edge function via HTTP POST
    - Uses the service role key for authentication

  3. Notes
    - The edge function checks for licenses expiring within 30 days
    - Sends reminder emails to both primary and alt email addresses
    - Uses RESEND_API_KEY configured in edge function secrets
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'license-reminder-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/license-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
