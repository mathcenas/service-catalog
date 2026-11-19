-- Los avisos de mantenimiento del repositorio de Kopia quedaban como backups "Kopia Backup" (y las
-- notificaciones de prueba también). Se pasan a la telemetría (source kopia-maintenance) y se borran
-- de service_backups; desde ahora ingest-kopia-webhook los manda directo ahí.
insert into public.service_heartbeats (user_id, service_id, source, status, message, payload, received_at)
select b.user_id, b.service_id, 'kopia-maintenance',
       case when b.details ~* '(unable to|despite \d+ retries|no such host|dial tcp|error)' then 'failed' else 'success' end,
       'Scheduled Maintenance' || case when b.details ~* 'no such host' then ': no se encontró el servidor del repositorio' else '' end,
       jsonb_build_object('operation', 'Scheduled Maintenance', 'details', b.details),
       b.backed_up_at
from public.service_backups b
where b.job_name = 'Kopia Backup' and b.details ~* 'Operation:\s*Scheduled Maintenance';

delete from public.service_backups
where job_name = 'Kopia Backup'
  and (details ~* 'Operation:\s*Scheduled Maintenance' or details ilike '%test notification from Kopia%');

delete from public.service_backups where job_name = 'Kopia - test' and details like 'snapshot_id=test123%';
