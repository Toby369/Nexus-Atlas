-- Exportiert aus supabase_migrations.schema_migrations (20261014121453 recreate_news_warning_pushes_sent)

create table if not exists public.news_warning_pushes_sent (
  warning_id text not null,
  mark_id text not null,
  event_date date not null,
  sent_at timestamptz not null default now(),
  primary key (warning_id, mark_id, event_date)
);
alter table public.news_warning_pushes_sent enable row level security;
-- Bereits verschickte Stufen von heute nachtragen, damit sie nicht erneut kommen.
insert into public.news_warning_pushes_sent (warning_id, mark_id, event_date)
values ('macro', 'macro830_t60', '2026-10-14')
on conflict do nothing;
