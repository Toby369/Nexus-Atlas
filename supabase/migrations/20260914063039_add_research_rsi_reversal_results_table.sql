-- Exportiert aus supabase_migrations.schema_migrations (20260914063039 add_research_rsi_reversal_results_table)

create table if not exists public.research_rsi_reversal_results (
  id bigint generated always as identity primary key,
  interval text not null,
  rsi_upper numeric not null,
  rsi_lower numeric not null,
  definition text not null,
  split text not null,
  direction text not null,
  n_signals int not null,
  n_tp int not null,
  n_sl int not null,
  n_timeout int not null,
  created_at timestamptz not null default now()
);
comment on table public.research_rsi_reversal_results is
  'Recherche 14.09.2026: RSI ueberkauft/ueberverkauft + Gegenbewegung -> Triple-Barrier-Ergebnisse (Tobys Setup), 5m/15m/1h x pattern/n_confirm x 70/30+80/20. Nicht produktiv verwendet, nur fuer docs/research/*.md.';
