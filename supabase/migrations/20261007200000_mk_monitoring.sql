-- MikroTik monitoring: site config and alert state

create table if not exists mk_site_config (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid not null references services(id) on delete cascade,
  router_ip      text not null,                      -- IP del router para REST API
  router_user    text not null default 'monitor',    -- usuario read-only en el router
  router_pass    text not null,                      -- contraseña (encriptada en reposo por Supabase)
  rdp_target_ip  text,                               -- IP a pingear (ej. 192.168.88.150)
  rdp_check_enabled bool not null default true,
  known_ips      text[] not null default '{}',       -- IPs conocidas (oficina, VPS, LAN)
  syslog_port    int  not null default 5140,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (service_id)
);

-- Alert state: una fila por (service_id, check_type), se upsertea en cada check
create table if not exists alert_state (
  id               uuid primary key default gen_random_uuid(),
  service_id       uuid not null references services(id) on delete cascade,
  check_type       text not null,   -- 'rdp_ping' | 'cpu' | 'ram' | 'login_bruteforce' | 'login_unknown_ip' | 'reboot'
  is_active        bool not null default false,
  triggered_at     timestamptz,
  recovered_at     timestamptz,
  last_notified_at timestamptz,
  detail           jsonb,
  unique (service_id, check_type)
);

-- Índice para consultas por servicio
create index if not exists alert_state_service_id_idx on alert_state (service_id);
create index if not exists mk_site_config_service_id_idx on mk_site_config (service_id);

-- RLS: mismas reglas que services (owner puede leer/escribir)
alter table mk_site_config enable row level security;
alter table alert_state    enable row level security;

create policy "owner_mk_site_config" on mk_site_config
  using (
    service_id in (select id from services where user_id = auth.uid())
  );

create policy "owner_alert_state" on alert_state
  using (
    service_id in (select id from services where user_id = auth.uid())
  );
