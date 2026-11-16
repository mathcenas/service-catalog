-- Tickets automáticos en Task Tracker a partir de las alertas del tablero "Para hoy".
-- sync-alert-tickets (cron cada hora) abre una tarea cuando aparece una alerta y la cierra
-- con una nota cuando la alerta desaparece dos chequeos seguidos.
--
-- alert_key: "<tipo>:<service_id>" — backup (fallido o vencido), signal (dejó de reportar),
-- ops (servicio caído/degradado). Una sola fila abierta por alert_key.

create table if not exists public.alert_tickets (
  id            uuid primary key default gen_random_uuid(),
  alert_key     text not null,
  kind          text not null check (kind in ('backup', 'signal', 'ops')),
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  service_id    uuid references public.services(id) on delete cascade,
  title         text not null,
  detail        text,
  status        text not null default 'open' check (status in ('open', 'resolved')),
  tt_task_id    text,                -- null: el cliente no tiene proyecto por defecto en Task Tracker
  tt_error      text,
  opened_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  clear_count   int not null default 0,  -- chequeos seguidos sin la alerta
  resolved_at   timestamptz,
  resolve_note  text
);

create unique index if not exists alert_tickets_one_open
  on public.alert_tickets (alert_key) where status = 'open';
create index if not exists alert_tickets_user_status on public.alert_tickets (user_id, status);
create index if not exists alert_tickets_service on public.alert_tickets (service_id);

alter table public.alert_tickets enable row level security;

drop policy if exists "alert_tickets owner read" on public.alert_tickets;
create policy "alert_tickets owner read" on public.alert_tickets
  for select to authenticated using (user_id = auth.uid());
-- Solo la función (service role) escribe.

select cron.schedule('sync-alert-tickets-hourly', '17 * * * *', $$select public.cron_call_function('sync-alert-tickets')$$);
