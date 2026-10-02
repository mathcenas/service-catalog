-- Audit log para acciones sobre notification_locks
-- Registra cada vez que un lock es liberado manualmente desde el UI
create table if not exists notification_lock_events (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null,
  event_type    text not null,
  action        text not null default 'released',  -- released | reset
  performed_by  uuid not null,                     -- auth.uid() del operador
  performed_at  timestamptz not null default now(),
  notes         text
);

alter table notification_lock_events enable row level security;

-- Solo puede leer eventos el usuario que los generó
create policy "owner read" on notification_lock_events
  for select using (performed_by = (select auth.uid()));

-- Las escrituras solo vienen del RPC SECURITY DEFINER (no desde el cliente directo)
create policy "no direct insert" on notification_lock_events
  for insert with check (false);

-- Actualizar RPC de borrado para que también registre el evento
create or replace function delete_my_notification_lock(p_lock_id uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  v_deleted  integer;
  v_service  uuid;
  v_etype    text;
begin
  -- Capturar datos antes de borrar
  select nl.service_id, nl.event_type
  into   v_service, v_etype
  from   notification_locks nl
  join   services            s  on s.id = nl.service_id
  join   clients             c  on c.id = s.client_id
  where  nl.id = p_lock_id
    and  c.user_id = auth.uid();

  if not found then
    return false;
  end if;

  -- Borrar el lock
  delete from notification_locks where id = p_lock_id;
  get diagnostics v_deleted = row_count;

  -- Registrar la acción
  if v_deleted > 0 then
    insert into notification_lock_events (service_id, event_type, action, performed_by)
    values (v_service, v_etype, 'released', auth.uid());
  end if;

  return v_deleted > 0;
end;
$$;
