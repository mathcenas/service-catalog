-- Los crons leían current_setting('app.supabase_url') / ('app.settings.supabase_url'),
-- que no existen en este proyecto: todos fallaban a diario sin llamar a ninguna función.
-- Ahora leen la URL del proyecto y la anon key desde Supabase Vault.
--
-- REQUISITO (una sola vez, a mano en el SQL editor; los valores NO van al repo):
--   select vault.create_secret('https://<proyecto>.supabase.co', 'project_url');
--   select vault.create_secret('<anon key>', 'cron_anon_key');
-- La anon key alcanza: el gateway solo exige un JWT válido y cada función usa su
-- propia service role interna para acceder a la base.
--
-- cron.schedule con un nombre existente actualiza ese job (no lo duplica).

create or replace function public.cron_call_function(fn text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_anon_key')
    ),
    body    := '{}'::jsonb
  );
$$;

revoke all on function public.cron_call_function(text) from public, anon, authenticated;

select cron.schedule('sync-script-versions-daily', '0 6 * * *', $$select public.cron_call_function('sync-script-versions')$$);
select cron.schedule('license-reminder-daily', '0 8 * * *', $$select public.cron_call_function('license-reminder')$$);
select cron.schedule('alert-backup-stale', '0 10 * * *', $$select public.cron_call_function('alert-backup-stale')$$);
select cron.schedule('backup-alert-digest-daily', '0 11 * * *', $$select public.cron_call_function('backup-alert-digest')$$);
select cron.schedule('client-digest-daily', '0 11 * * *', $$select public.cron_call_function('client-weekly-digest')$$);
