-- Exportiert aus supabase_migrations.schema_migrations (20260910025933 create_signal_review_snapshots)


-- Periodischer KI-Rueckblick Phase 3 (10.09.2026): KI-Kachel, die
-- AUSSCHLIESSLICH die in Phase 2 fertig berechneten Zahlen aus
-- signal_stats_results liest und eine verstaendliche deutsche Einordnung
-- schreibt -- kein eigener Bias, kein Handelssignal (siehe
-- lib/ai/promptProfiles.ts "signal-review"). Gleiches Schema-Muster wie
-- signal_engine_snapshots.
create table public.signal_review_snapshots (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  provider text,
  model text,
  result jsonb,
  status text not null check (status in ('ok', 'error')),
  error text
);

comment on table public.signal_review_snapshots is
  'Periodischer KI-Rueckblick Phase 3 (10.09.2026): KI-Einordnung von signal_stats_results (Phase 2) -- liest ausschliesslich die fertig berechneten Zahlen, erfindet keine eigene Bewertung. Nur ueber POST /api/signal-review/generate geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen. Wird woechentlich vom signal-review-scheduler-Cron ausgeloest (Phase 3).';

alter table public.signal_review_snapshots enable row level security;

create policy "Public read access" on public.signal_review_snapshots
  for select using (true);
