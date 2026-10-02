-- ============================================================
-- Centro de Notificaciones — migración
-- Correr en Supabase SQL Editor
-- ============================================================

-- 1. Agregar contact_id y campos de tracking a email_opens
alter table email_opens
  add column if not exists contact_id   uuid references client_contacts(id) on delete set null,
  add column if not exists email_type   text,        -- 'welcome' | 'backup' | 'digest' | etc
  add column if not exists sent_at      timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at    timestamptz;

-- Índice para lookup rápido por contacto
create index if not exists email_opens_contact_id_idx on email_opens(contact_id);
create index if not exists email_opens_resend_id_idx  on email_opens(resend_email_id);

-- 2. Agregar contact_id a email_clicks también
alter table email_clicks
  add column if not exists contact_id uuid references client_contacts(id) on delete set null;

create index if not exists email_clicks_contact_id_idx on email_clicks(contact_id);

-- 3. Agregar campo subscription_confirmed a client_contacts
--    true = contacto confirmó recepción (abrió al menos un email)
alter table client_contacts
  add column if not exists subscription_confirmed boolean default false,
  add column if not exists welcome_sent_at        timestamptz,
  add column if not exists last_email_at          timestamptz;

-- 4. Tablas de topología de red (si no se crearon antes)
create table if not exists net_devices (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid references clients(id) on delete cascade,
  site_id            text not null,
  device_id          text not null,
  type               text not null default 'unmanaged',
  hostname           text,
  ip                 text,
  model              text,
  status             text default 'unknown',
  uptime_seconds     int,
  throughput_in_bps  bigint,
  throughput_out_bps bigint,
  raw_data           jsonb,
  source             text,
  last_seen_at       timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (client_id, site_id, device_id)
);

create table if not exists net_edges (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  site_id          text not null,
  source_device_id text not null,
  target_device_id text not null,
  link_type        text default 'ethernet',
  label            text,
  raw_data         jsonb,
  updated_at       timestamptz default now()
);

create table if not exists net_layout_overrides (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  site_id    text not null,
  device_id  text not null,
  x          float not null,
  y          float not null,
  updated_at timestamptz default now(),
  unique (client_id, site_id, device_id)
);
