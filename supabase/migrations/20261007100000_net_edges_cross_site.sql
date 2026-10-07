-- Allow net_edges and net_layout_overrides to be cross-site (client-scoped)

-- net_edges: make site_id nullable, add client_id for cross-site VPN links
alter table net_edges
  alter column site_id drop not null,
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- net_layout_overrides: make site_id nullable, add client_id for "Todos" view positions
alter table net_layout_overrides
  alter column site_id drop not null,
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- Keep a unique constraint on (service_id, site_id) for non-null site_id rows.
-- PostgREST upsert ON CONFLICT requires a real constraint, not just a partial index.
-- We achieve this by keeping the original constraint name and adding a separate
-- partial unique index for the client-scoped (site_id IS NULL) case.
alter table net_layout_overrides
  drop constraint if exists net_layout_overrides_service_id_site_id_key;

-- Recreate as a constraint so PostgREST can use it for ON CONFLICT
alter table net_layout_overrides
  add constraint net_layout_overrides_service_id_site_id_key
  unique (service_id, site_id);

-- Partial index for client-scoped rows (site_id IS NULL)
create unique index if not exists net_layout_overrides_client_unique
  on net_layout_overrides (service_id, client_id)
  where site_id is null and client_id is not null;
