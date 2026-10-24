-- Exportiert aus supabase_migrations.schema_migrations (20260910051934 create_divergence_radar_snapshots)


-- Periodischer KI-Rueckblick Phase 5 (10.09.2026): der Divergenz-Radar
-- (lib/divergenceRadar.ts/divergenceRadarContext.ts) wurde bisher nur live
-- fuer die Dashboard-Anzeige berechnet, nirgends persistiert -- ohne
-- Historie ist kein Backtest moeglich (siehe Plan-Luecke aus Phase 4).
-- Diese Tabelle speichert bei jedem Snapshot sowohl die acht fertig
-- berechneten Paar-Status ALS AUCH die Rohwerte, aus denen sie entstanden
-- sind (price/overall_state/tv-Richtung/handelslage-Bias/Zyklus-Band) --
-- damit spaetere Detection-Erweiterungen fuer die noch zurueckgestellten
-- Paare (cycleVsMomentum, handelslageVsState, tradingViewVsState,
-- optionsVsSentiment, spotVsFutures) ohne weitere Schema-Aenderung
-- nachgezogen werden koennen.
create table public.divergence_radar_snapshots (
  id bigint generated always as identity primary key,
  snapshotted_at timestamptz not null default now(),
  price numeric,
  overall_state text,
  options_vs_sentiment text not null,
  spot_vs_futures text not null,
  spot_pressure_vs_price text not null,
  cycle_vs_momentum text not null,
  cycle_band_label text,
  handelslage_vs_state text not null,
  handelslage_bias text,
  tradingview_vs_state text not null,
  tv_direction text,
  rsi_divergence_vs_trend text not null,
  rsi_macd_divergence_direction text,
  onchain_vs_price text not null,
  created_at timestamptz not null default now()
);

comment on table public.divergence_radar_snapshots is
  'Periodischer KI-Rueckblick Phase 5 (10.09.2026): periodischer Snapshot aller 8 Divergenz-Radar-Paare (lib/divergenceRadarContext.ts::buildDivergenceRadar) inkl. Rohwerte -- Grundlage fuer signal_outcomes-Detection. Nur ueber POST /api/divergence-radar/snapshot geschrieben (service_role, vom divergence-radar-scheduler-Cron alle 15 Min ausgeloest), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

create index divergence_radar_snapshots_snapshotted_at_idx on public.divergence_radar_snapshots (snapshotted_at);

alter table public.divergence_radar_snapshots enable row level security;

create policy "Public read access" on public.divergence_radar_snapshots
  for select using (true);
