alter table clients
  add column if not exists digest_enabled boolean not null default false,
  add column if not exists digest_day     text    not null default 'monday';
-- digest_day values: 'monday' | 'tuesday' | ... (pg_cron filter)
