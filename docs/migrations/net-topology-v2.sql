-- ============================================================
-- Red: Sites + Topología v2
-- Correr en Supabase SQL Editor
-- ============================================================

-- 1. Tabla de ubicaciones físicas por cliente
create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,             -- texto para compatibilidad con clients.id
  name        text not null,             -- ej: 'Casa Central', 'Sucursal Norte'
  address     text,
  city        text,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists sites_client_id_idx on sites(client_id);

-- RLS: el usuario dueño del cliente puede ver/modificar sus sites
alter table sites enable row level security;

create policy "sites: owner full access" on sites
  using (
    client_id in (
      select id::text from clients where user_id::text = auth.uid()::text
    )
  );

-- 2. Dispositivos físicos de red
create table if not exists net_devices (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid references sites(id) on delete cascade not null,
  name         text not null,
  device_type  text not null,           -- 'mikrotik' | 'google_wifi' | 'switch_unmanaged' | 'nvr' | 'server' | 'workstation'
  ip_address   text,
  mac_address  text,
  model        text,
  status       text default 'online',   -- 'online' | 'offline' | 'warning' | 'unknown'
  last_seen    timestamptz default now(),
  raw_data     jsonb,
  source       text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (site_id, mac_address)
);

create index if not exists net_devices_site_id_idx on net_devices(site_id);

alter table net_devices enable row level security;

create policy "net_devices: owner via site" on net_devices
  using (
    site_id in (
      select s.id from sites s
      where s.client_id in (
        select id::text from clients where user_id::text = auth.uid()::text
      )
    )
  );

-- 3. Conexiones (aristas de la topología)
create table if not exists net_links (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid references sites(id) on delete cascade not null,
  source_device_id uuid references net_devices(id) on delete cascade not null,
  target_device_id uuid references net_devices(id) on delete cascade not null,
  source_port      text,
  target_port      text,
  link_type        text default 'utp',  -- 'utp' | 'fiber' | 'mesh_wifi'
  label            text,
  updated_at       timestamptz default now()
);

create index if not exists net_links_site_id_idx on net_links(site_id);

alter table net_links enable row level security;

create policy "net_links: owner via site" on net_links
  using (
    site_id in (
      select s.id from sites s
      where s.client_id in (
        select id::text from clients where user_id::text = auth.uid()::text
      )
    )
  );

-- 4. Posiciones del canvas (una fila por dispositivo, evita race conditions)
create table if not exists net_layout_overrides (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid references sites(id) on delete cascade not null,
  device_id  uuid references net_devices(id) on delete cascade not null,
  x          float not null,
  y          float not null,
  updated_at timestamptz default now(),
  unique (site_id, device_id)
);

alter table net_layout_overrides enable row level security;

create policy "net_layout: owner via site" on net_layout_overrides
  using (
    site_id in (
      select s.id from sites s
      where s.client_id in (
        select id::text from clients where user_id::text = auth.uid()::text
      )
    )
  );
