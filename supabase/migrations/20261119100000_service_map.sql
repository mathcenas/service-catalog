-- Mapa de servicios de un servidor (Red → Servidores). Los nodos salen solos del último reporte de
-- system-health (contenedores de Docker y equipos de Tailscale); acá se guarda solo lo que el admin
-- corrige o confirma. host_service_id = el servicio cuyo reporte dibuja el mapa.

create table if not exists public.service_map_nodes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  host_service_id uuid not null references public.services(id) on delete cascade,
  node            text not null,                 -- nombre del contenedor / equipo
  role            text check (role in ('proxy', 'app', 'testing', 'db', 'storage', 'tool', 'vpn')),
  service_id      uuid references public.services(id) on delete set null,  -- servicio del catálogo que es este nodo
  hidden          boolean not null default false,
  notes           text,
  updated_at      timestamptz not null default now(),
  unique (host_service_id, node)
);

create table if not exists public.service_map_edges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  host_service_id uuid not null references public.services(id) on delete cascade,
  a               text not null,
  b               text not null,
  status          text not null check (status in ('confirmed', 'removed')),
  updated_at      timestamptz not null default now(),
  unique (host_service_id, a, b)
);

alter table public.service_map_nodes enable row level security;
alter table public.service_map_edges enable row level security;

drop policy if exists "service_map_nodes owner" on public.service_map_nodes;
create policy "service_map_nodes owner" on public.service_map_nodes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "service_map_edges owner" on public.service_map_edges;
create policy "service_map_edges owner" on public.service_map_edges
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
