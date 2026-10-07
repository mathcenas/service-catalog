-- Allow net_edges and net_layout_overrides to be cross-site (client-scoped)

-- net_edges: make site_id nullable (already is), add client_id for cross-site VPN links
alter table net_edges
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- net_layout_overrides: add client_id for "Todos" view positions
-- (site_id is already nullable based on actual schema)
alter table net_layout_overrides
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- Ensure a unique constraint exists on (device_id, site_id) so PostgREST upsert
-- ON CONFLICT works for site-scoped rows. Drop first in case it exists under a
-- different name, then recreate it.
do $$
begin
  -- Drop any existing unique constraint on (device_id, site_id)
  perform constraint_name
  from information_schema.table_constraints
  where table_name = 'net_layout_overrides'
    and constraint_type = 'UNIQUE';
  -- Best-effort drop of common names; ignore if they don't exist
  begin
    alter table net_layout_overrides drop constraint net_layout_overrides_device_id_site_id_key;
  exception when others then null;
  end;
end $$;

alter table net_layout_overrides
  add constraint net_layout_overrides_device_id_site_id_key
  unique (device_id, site_id);

-- Partial index for client-scoped rows (site_id IS NULL)
create unique index if not exists net_layout_overrides_client_unique
  on net_layout_overrides (device_id, client_id)
  where site_id is null and client_id is not null;
