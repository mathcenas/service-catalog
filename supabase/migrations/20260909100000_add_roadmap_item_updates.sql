create table if not exists roadmap_item_updates (
  id            uuid primary key default gen_random_uuid(),
  roadmap_item_id uuid not null references roadmap_items(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  note          text,
  status        text,
  created_at    timestamptz not null default now()
);

alter table roadmap_item_updates enable row level security;

-- Owners can do anything
create policy "owner_all" on roadmap_item_updates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Anon can read updates for public roadmap items (used by share page)
create policy "anon_read_public" on roadmap_item_updates
  for select to anon
  using (
    exists (
      select 1 from roadmap_items ri
      where ri.id = roadmap_item_updates.roadmap_item_id
        and ri.is_public = true
    )
  );

create index on roadmap_item_updates (roadmap_item_id, created_at);
