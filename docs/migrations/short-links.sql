-- Link shortener para share links de clientes
create table if not exists short_links (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  client_id   uuid references clients(id) on delete cascade,
  target_url  text not null,
  label       text,                          -- ej: "Portal welcome email Oct 2026"
  created_at  timestamptz default now(),
  expires_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null
);

create table if not exists link_clicks (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null references short_links(slug) on delete cascade,
  clicked_at     timestamptz default now(),
  referrer       text,
  email_open_id  uuid references email_opens(id) on delete set null
);

create index if not exists link_clicks_slug_idx on link_clicks(slug);
create index if not exists link_clicks_clicked_at_idx on link_clicks(clicked_at desc);

alter table short_links enable row level security;
alter table link_clicks  enable row level security;

-- Solo el creador puede ver/gestionar sus links
create policy "owner manages short_links" on short_links
  for all using (created_by = auth.uid());

-- Clicks: solo lectura para el creador del link
create policy "owner reads link_clicks" on link_clicks
  for select using (
    exists (
      select 1 from short_links sl
      where sl.slug = link_clicks.slug
        and sl.created_by = auth.uid()
    )
  );

-- Vista útil para el dashboard
create or replace view short_link_stats as
select
  sl.id,
  sl.slug,
  sl.client_id,
  sl.label,
  sl.target_url,
  sl.created_at,
  sl.expires_at,
  sl.created_by,
  count(lc.id)                                  as total_clicks,
  max(lc.clicked_at)                            as last_clicked_at,
  count(lc.id) filter (
    where lc.clicked_at > now() - interval '7 days'
  )                                              as clicks_7d
from short_links sl
left join link_clicks lc on lc.slug = sl.slug
group by sl.id, sl.slug, sl.client_id, sl.label, sl.target_url,
         sl.created_at, sl.expires_at, sl.created_by;
