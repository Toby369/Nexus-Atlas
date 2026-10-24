-- Exportiert aus supabase_migrations.schema_migrations (20260910052935 create_detect_divergence_radar_outcomes)


-- Periodischer KI-Rueckblick Phase 5: Detection fuer die 3 Divergenz-Radar-
-- Paare mit einer bereits im Code selbst dokumentierten, eindeutigen
-- Richtung (siehe lib/divergenceRadar.ts-Kommentare). Die restlichen 5
-- Paare (optionsVsSentiment, spotVsFutures, cycleVsMomentum,
-- handelslageVsState, tradingViewVsState) sind bewusst zurueckgestellt --
-- deren Divergenz-Zustand impliziert keine eindeutige Richtung ohne
-- zusaetzliche, nicht im Code begruendete Annahme. divergence_radar_snapshots
-- speichert bereits alle Rohwerte, damit diese Erweiterung spaeter ohne
-- Schema-Aenderung nachgezogen werden kann.
--
-- Transition-Erkennung wie in Phase 1/4: nur der erste Snapshot einer neuen
-- Kombination zaehlt (LAG-Vergleich) -- tvDirection/rsiMacdDivergenceDirection
-- bleiben laut isSignalFresh() bis zu 24h "aktiv", wuerden also sonst bei
-- jedem 15-Min-Snapshot erneut gezaehlt.

-- 1) Spot-Pressure-Absorption: "ABSORPTION_BULLISH"/"ABSORPTION_BEARISH"
--    sind bereits per Namenskonvention gerichtet (siehe
--    computeSpotPressureVsPriceDivergence-Kommentar: "Staerke-/Schwaeche-
--    Signal").
create or replace function public.detect_spot_pressure_absorption_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.spot_pressure_vs_price,
      case s.spot_pressure_vs_price
        when 'ABSORPTION_BULLISH' then 'spot_pressure_absorption_bullish'
        when 'ABSORPTION_BEARISH' then 'spot_pressure_absorption_bearish'
        else null
      end as signal_type,
      case s.spot_pressure_vs_price
        when 'ABSORPTION_BULLISH' then 'bullish'
        when 'ABSORPTION_BEARISH' then 'bearish'
        else null
      end as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.spot_pressure_vs_price) over (order by r.id) as prev_value
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and spot_pressure_vs_price is distinct from prev_value and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- 2) Onchain vs. Preis: Analogie zu den Phase-1-Warn-Mustern (Distribution
--    Warning=bearish, Capitulation=bullish) -- "Preis nahe Hoch, aber SOPR
--    zeigt Verlust-Bewegung" ist dieselbe Distribution-Anomalie-Lesart,
--    "Preis nahe Tief, aber SOPR zeigt Profit-Bewegung" dieselbe
--    Kapitulations-Widerstandsfaehigkeits-Lesart.
create or replace function public.detect_onchain_vs_price_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.onchain_vs_price,
      case s.onchain_vs_price
        when 'PRICE_HIGH_SOPR_LOSS' then 'onchain_vs_price_bearish'
        when 'PRICE_LOW_SOPR_PROFIT' then 'onchain_vs_price_bullish'
        else null
      end as signal_type,
      case s.onchain_vs_price
        when 'PRICE_HIGH_SOPR_LOSS' then 'bearish'
        when 'PRICE_LOW_SOPR_PROFIT' then 'bullish'
        else null
      end as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.onchain_vs_price) over (order by r.id) as prev_value
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and onchain_vs_price is distinct from prev_value and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- 3) RSI/MACD-Divergenz vs. Trendkontext: Richtung ist die eigene
--    Divergenzrichtung (rsi_macd_divergence_direction), segmentiert danach,
--    ob sie gegen einen intakten Trend laeuft (GEGEN_INTAKTEN_TREND) oder
--    nicht (OHNE_GEGENTREND) -- dieselbe Fragestellung wie
--    METHODIC_DIVERGENCE_2026-08-29.md/die Structure-vs-Trend-Strength-
--    Auswertung vom 05.09.2026, hier fuer RSI/MACD statt Struktur.
create or replace function public.detect_rsi_divergence_vs_trend_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.rsi_macd_divergence_direction, s.rsi_divergence_vs_trend,
      case
        when s.rsi_macd_divergence_direction is null or s.rsi_divergence_vs_trend not in ('GEGEN_INTAKTEN_TREND', 'OHNE_GEGENTREND')
          then null
        else 'rsi_divergence_' || s.rsi_macd_divergence_direction || '_' ||
          case s.rsi_divergence_vs_trend
            when 'GEGEN_INTAKTEN_TREND' then 'gegentrend'
            else 'ohne_gegentrend'
          end
      end as signal_type,
      s.rsi_macd_divergence_direction as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.signal_type) over (order by r.id) as prev_signal_type
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and signal_type is distinct from prev_signal_type and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.detect_spot_pressure_absorption_outcomes is
  'Periodischer KI-Rueckblick Phase 5 (10.09.2026): backfillt/trackt Spot-Pressure-Absorption (divergence_radar_snapshots.spot_pressure_vs_price) in signal_outcomes als spot_pressure_absorption_bullish/bearish. Transition-basiert, x Horizonte [4,12,24]h. Idempotent.';
comment on function public.detect_onchain_vs_price_outcomes is
  'Periodischer KI-Rueckblick Phase 5 (10.09.2026): backfillt/trackt Onchain-vs-Preis-Anomalien (divergence_radar_snapshots.onchain_vs_price) in signal_outcomes als onchain_vs_price_bullish/bearish, Analogie zu den Phase-1-Warn-Mustern. Transition-basiert, x Horizonte [4,12,24]h. Idempotent.';
comment on function public.detect_rsi_divergence_vs_trend_outcomes is
  'Periodischer KI-Rueckblick Phase 5 (10.09.2026): backfillt/trackt RSI/MACD-Divergenzrichtung segmentiert nach Trendkontext (divergence_radar_snapshots.rsi_macd_divergence_direction x rsi_divergence_vs_trend) in signal_outcomes. Transition-basiert, x Horizonte [4,12,24]h. Idempotent.';

revoke execute on function public.detect_spot_pressure_absorption_outcomes() from public;
revoke execute on function public.detect_onchain_vs_price_outcomes() from public;
revoke execute on function public.detect_rsi_divergence_vs_trend_outcomes() from public;
