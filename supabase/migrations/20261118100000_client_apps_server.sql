-- "Qué corre en este equipo": cada app / impresora / carpeta compartida / servicio puede quedar
-- asociada al servicio (servidor o PC) donde vive. Se muestra en el formulario del servicio, en el
-- mapa y, agrupado por equipo y desplegable, en el portal del cliente.

alter table public.client_apps
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists kind text not null default 'app';

alter table public.client_apps drop constraint if exists client_apps_kind_check;
alter table public.client_apps add constraint client_apps_kind_check
  check (kind in ('app', 'printer', 'share', 'database', 'service', 'other'));

create index if not exists client_apps_service on public.client_apps (service_id);
