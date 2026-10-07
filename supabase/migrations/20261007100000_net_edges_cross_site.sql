-- Allow net_edges and net_layout_overrides to be cross-site (client-scoped)
-- net_edges: make site_id nullable, add client_id for cross-site VPN links
alter table net_edges
  alter column site_id drop not null,
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- net_layout_overrides: make site_id nullable, add client_id for "Todos" view positions
alter table net_layout_overrides
  alter column site_id drop not null,
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- Drop the old unique constraint and recreate to handle nulls
alter table net_layout_overrides
  drop constraint if exists net_layout_overrides_service_id_site_id_key;

create unique index if not exists net_layout_overrides_site_unique
  on net_layout_overrides (service_id, site_id)
  where site_id is not null;

create unique index if not exists net_layout_overrides_client_unique
  on net_layout_overrides (service_id, client_id)
  where site_id is null and client_id is not null;
