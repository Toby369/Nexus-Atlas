-- Exportiert aus supabase_migrations.schema_migrations (20260914112153 create_youtube_overall_analyses)

create table youtube_overall_analyses (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  video_count int not null,
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text
);

comment on table youtube_overall_analyses is
  'Gesamtanalyse ueber mehrere zuletzt analysierte YouTube-Videos (Nutzer-Wunsch 14.09.2026: "gesamt analyse der einzelnen analysierten youtube beitraege"). Synthetisiert (Widersprueche explizit benannt statt gemittelt), analog zum Master-Report der AI Report Engine, aber fuer den YouTube-Monitor.';

alter table youtube_overall_analyses enable row level security;

create policy "Public read access" on youtube_overall_analyses
  for select using (true);
