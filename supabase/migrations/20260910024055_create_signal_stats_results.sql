-- Exportiert aus supabase_migrations.schema_migrations (20260910024055 create_signal_stats_results)


-- Periodischer KI-Rueckblick, Phase 2 (10.09.2026): Statistik-Pipeline ueber
-- die in Phase 1 gesammelten signal_outcomes. Zwei getrennte Fenster
-- ("90d" = rollierende letzte 90 Tage, "all" = gesamte Historie) machen
-- Signal-Verfall sichtbar (Recherche-Ergebnis: Rolling-Hit-Rate-Tracking +
-- Signal-Decay-Erkennung ist branchenueblich fuer genau diese Aufgabe).
--
-- Kein Run-Verlauf noetig: jeder woechentliche Lauf ersetzt (upsert) den
-- Stand je (window_label, category, signal_type, horizon_hours) komplett --
-- anders als research_pattern_results_purged (einmaliger akademischer
-- Backtest mit wachsender kumulativer FDR-Korrektur ueber alle jemals
-- getesteten Zellen, um "FDR-Shopping" durch wiederholte manuelle Neustarts
-- zu verhindern) ist dies eine automatisierte, nicht-interaktive
-- Routine-Auswertung IMMER DERSELBEN festen Zellen mit aktualisierten
-- Daten -- die BH-FDR-Korrektur laeuft deshalb bei jedem Lauf frisch ueber
-- die aktuell berechneten Zellen desselben Fensters, nicht kumulativ ueber
-- alle jemals gelaufenen Wochen.
create table public.signal_stats_results (
  id bigint generated always as identity primary key,
  window_label text not null check (window_label in ('90d', 'all')),
  category text not null,
  signal_type text not null,
  horizon_hours integer not null,
  direction_expected text check (direction_expected in ('bullish', 'bearish')),
  test_type text not null check (test_type in ('directional', 'magnitude')),
  n integer not null,
  hit_rate_pct numeric,
  baseline_hit_rate_pct numeric,
  avg_return_pct numeric,
  avg_abs_return_pct numeric,
  baseline_avg_abs_return_pct numeric,
  raw_p_value numeric,
  rank integer,
  bh_critical_value numeric,
  significant_after_bh boolean,
  computed_at timestamptz not null default now(),
  constraint signal_stats_results_unique_cell unique (window_label, category, signal_type, horizon_hours)
);

comment on table public.signal_stats_results is
  'Periodischer KI-Rueckblick Phase 2 (10.09.2026): woechentlich neu berechnete Trefferquote/Baseline/BH-FDR je (Fenster x Signal x Horizont), aus signal_outcomes. test_type=directional (hit_rate_pct/baseline_hit_rate_pct gefuellt) fuer Signale mit direction_expected, test_type=magnitude (avg_abs_return_pct/baseline_avg_abs_return_pct gefuellt) fuer richtungslose Risk-Faktoren. raw_p_value/rank/bh_critical_value/significant_after_bh sind NULL, wenn n unter der Mindeststichprobe liegt (keine erfundene Aussage bei kleiner Stichprobe).';

alter table public.signal_stats_results enable row level security;

create policy "Public read access" on public.signal_stats_results
  for select using (true);
