alter table clients add column if not exists risk_flags text[] not null default '{}';
