-- Exportiert aus supabase_migrations.schema_migrations (20260908023344 create_trade_debate_snapshots)

-- Trade-Debate-Kachel (Nutzer-Idee 07.09.2026): Bull-/Bear-Analyst +
-- Referee/CIO. Gleiches Schema-Muster wie escalation_snapshots (bigint
-- identity id, jsonb fuer die strukturierten AI-Ergebnisse, oeffentlicher
-- Lesezugriff wie alle anderen Snapshot-Tabellen).
create table public.trade_debate_snapshots (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  bull_read jsonb,
  bear_read jsonb,
  referee_provider text,
  referee_model text,
  referee_result jsonb,
  verdict text,
  status text not null,
  error text
);

alter table public.trade_debate_snapshots enable row level security;

create policy "Public read access"
  on public.trade_debate_snapshots
  for select
  to public
  using (true);
