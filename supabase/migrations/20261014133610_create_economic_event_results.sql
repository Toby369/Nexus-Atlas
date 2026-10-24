-- Exportiert aus supabase_migrations.schema_migrations (20261014133610 create_economic_event_results)

create table if not exists public.economic_event_results (
  event_key text not null,
  event_date date not null,
  bias text not null check (bias in ('bullish','bearish','neutral')),
  summary text not null,
  headlines jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  primary key (event_key, event_date)
);
comment on table public.economic_event_results is 'KI-Kurzeinordnung (1-2 Saetze + bullish/bearish) eines Wirtschaftstermins aus den ersten News-Schlagzeilen nach Veroeffentlichung. Geschrieben von /api/economic-result/generate, gelesen von Lagebild, Kalender-Kachel und send-state-change-push.';
alter table public.economic_event_results enable row level security;
create policy "Public read access" on public.economic_event_results for select using (true);
