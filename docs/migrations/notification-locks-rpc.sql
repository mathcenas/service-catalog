-- RPCs para que el frontend lea y borre notification_locks del usuario actual
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

-- RPC para borrar un lock verificando que pertenece al usuario actual
create or replace function delete_my_notification_lock(p_lock_id uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  v_deleted integer;
begin
  delete from notification_locks nl
  using services s
  join clients c on c.id = s.client_id
  where nl.id = p_lock_id
    and nl.service_id = s.id
    and c.user_id = auth.uid();

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
