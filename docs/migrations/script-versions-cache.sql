-- Cache de versiones de scripts — actualizado por la Edge Function sync-script-versions
create table if not exists script_versions (
  source        text not null,
  variant       text not null check (variant in ('windows', 'windowsServer', 'linux')),
  version       text not null,
  fetched_at    timestamptz not null default now(),
  primary key (source, variant)
);

-- Solo lectura para usuarios autenticados
alter table script_versions enable row level security;
create policy "read script_versions" on script_versions
  for select using (auth.role() = 'authenticated');
