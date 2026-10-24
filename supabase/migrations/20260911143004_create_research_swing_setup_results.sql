-- Exportiert aus supabase_migrations.schema_migrations (20260911143004 create_research_swing_setup_results)

-- Persistierte Ergebnisse von research_swing_setup_events() -- gleiche Rolle wie
-- research_triple_barrier_results, aber mit dem erweiterten Trailing-Ausgang.
create table if not exists public.research_swing_setup_results (
  id bigint generated always as identity primary key,
  interval text not null,
  direction text not null,
  tp_pct numeric not null,
  sl_pct numeric not null,
  retrace_pct numeric not null,
  vertical_bars integer not null,
  signal_time timestamptz not null,
  entry_time timestamptz not null,
  entry_price numeric not null,
  outcome text not null,
  resolution_time timestamptz,
  bars_to_resolution integer,
  mfe_pct numeric,
  created_at timestamptz not null default now(),
  unique (interval, direction, tp_pct, sl_pct, retrace_pct, vertical_bars, signal_time)
);

alter table public.research_swing_setup_results enable row level security;
create policy "Public read access" on public.research_swing_setup_results for select using (true);
revoke all on public.research_swing_setup_results from anon, authenticated;
grant select on public.research_swing_setup_results to anon, authenticated;
