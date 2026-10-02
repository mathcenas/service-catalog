-- RPC para que el frontend lea los notification_locks del usuario actual
-- La función corre con SECURITY DEFINER, bypasea RLS y filtra por owner
create or replace function get_my_notification_locks()
returns table (
  lock_id          uuid,
  service_id       uuid,
  service_name     text,
  client_id        uuid,
  client_name      text,
  event_type       text,
  last_sent_at     timestamptz,
  send_count       integer,
  suppressed_count integer,
  cooldown_expires timestamptz,
  cooldown_active  boolean
)
language plpgsql
security definer
as $$
begin
  return query
  select
    nl.id                                                          as lock_id,
    nl.service_id,
    s.name                                                         as service_name,
    s.client_id,
    c.company_name                                                 as client_name,
    nl.event_type,
    nl.last_sent_at,
    nl.send_count,
    nl.suppressed_count,
    nl.last_sent_at + interval '23 hours'                         as cooldown_expires,
    nl.last_sent_at + interval '23 hours' > now()                 as cooldown_active
  from notification_locks nl
  join services s  on s.id = nl.service_id
  join clients  c  on c.id = s.client_id
  where c.user_id = auth.uid()
  order by nl.last_sent_at desc;
end;
$$;
