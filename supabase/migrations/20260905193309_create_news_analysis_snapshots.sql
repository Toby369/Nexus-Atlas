-- Exportiert aus supabase_migrations.schema_migrations (20260905193309 create_news_analysis_snapshots)


create table public.news_analysis_snapshots (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text
);

comment on table public.news_analysis_snapshots is
  'KI-Einordnung der bereits regelbasiert als markbewegend eingestuften News (news_events) -- News-Kachel (KI-Ergaenzung, 05.09.2026), erster mit Perplexity aktivierter Kachel-Slot. Nur ueber POST /api/news-analysis/generate geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.news_analysis_snapshots enable row level security;

create policy "Public read access" on public.news_analysis_snapshots
  for select
  to public
  using (true);
