-- Tickets automáticos: alertas de salud del equipo (system-health en estado fallido) y
-- novedades que se van agregando como notas a la tarea de Task Tracker mientras sigue abierta.
alter table public.alert_tickets drop constraint if exists alert_tickets_kind_check;
alter table public.alert_tickets add constraint alert_tickets_kind_check check (kind in ('backup', 'signal', 'ops', 'health'));
alter table public.alert_tickets
  add column if not exists last_note_sig text,          -- problemas (sin números) de la última nota enviada
  add column if not exists last_note_at  timestamptz,
  add column if not exists notes_sent    int not null default 0;
