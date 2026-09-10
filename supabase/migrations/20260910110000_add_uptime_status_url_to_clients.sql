alter table clients add column if not exists uptime_status_url text;

-- Migrate existing value from first active service per client
update clients c
set uptime_status_url = (
  select s.uptime_status_url
  from services s
  where s.client_id = c.id
    and s.uptime_status_url is not null
    and s.uptime_status_url <> ''
  order by s.created_at
  limit 1
)
where exists (
  select 1 from services s
  where s.client_id = c.id
    and s.uptime_status_url is not null
    and s.uptime_status_url <> ''
);
