-- Exportiert aus supabase_migrations.schema_migrations (20260910020529 create_signal_outcomes)


-- Periodischer KI-Rueckblick, Phase 1 (09.09.2026): zentrale Outcome-Tabelle
-- fuer ALLE live/regelbasiert gefeuerten Signale (TradingView-Alerts,
-- Warn-Muster, Risk-Faktoren -- weitere Gruppen folgen in spaeteren Phasen).
-- Ein Datensatz pro (gefeuertes Signal x fester Horizont) -- gleiches
-- Prinzip wie research_pattern_results_purged, aber fuer laufende
-- Live-Beobachtung statt einmaligem Train/Val/Test-Backtest: kein
-- Split/Purge/Embargo hier (das war fuer den geschuetzten historischen
-- Backtest notwendig, hier gibt es keine "Zukunft", die versehentlich
-- durchsickern koennte -- jedes Signal wird erst NACH Ablauf seines
-- Horizonts befuellt).
--
-- direction_expected ist bewusst NULLABLE: nicht jedes Signal hat eine
-- inhaerente Richtung (z.B. "elevated_volatility" oder "low_mtf_alignment"
-- sind reine Risiko-/Magnitude-Flags ohne Richtungsaussage). Die spaetere
-- Statistik-Pipeline (Phase 2) entscheidet je nach category/signal_type,
-- ob ein Treffer-/Richtungstest (hit) oder ein reiner Magnitude-Test
-- (|return_pct|) sinnvoll ist -- diese Tabelle speichert nur die dafuer
-- ausreichenden Rohdaten.
create table public.signal_outcomes (
  id bigint generated always as identity primary key,
  category text not null,
  signal_type text not null,
  direction_expected text check (direction_expected in ('bullish', 'bearish')),
  fired_at timestamptz not null,
  price_at_signal numeric not null,
  horizon_hours integer not null,
  source_table text not null,
  source_id text not null,
  outcome_price numeric,
  outcome_at timestamptz,
  return_pct numeric,
  hit boolean,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint signal_outcomes_unique_instance unique (source_table, source_id, horizon_hours)
);

comment on table public.signal_outcomes is
  'Periodischer KI-Rueckblick Phase 1 (09.09.2026): ein Datensatz pro (gefeuertes Signal x fester Horizont), fuer alle live/regelbasiert erkannten Signal-Gruppen (TradingView-Alerts, Warn-Muster, Risk-Faktoren -- weitere folgen). outcome_* bleibt NULL bis der jeweilige Horizont abgelaufen ist (befuellt von fill_signal_outcomes()). direction_expected ist NULL fuer Signale ohne inhaerente Richtung (z.B. elevated_volatility) -- dann ist nur ein Magnitude-Test (return_pct) sinnvoll, kein Treffertest.';

create index signal_outcomes_category_type_idx on public.signal_outcomes (category, signal_type);
create index signal_outcomes_fired_at_idx on public.signal_outcomes (fired_at);
create index signal_outcomes_pending_fill_idx on public.signal_outcomes (fired_at) where filled_at is null;

alter table public.signal_outcomes enable row level security;

create policy "Public read access" on public.signal_outcomes
  for select using (true);
