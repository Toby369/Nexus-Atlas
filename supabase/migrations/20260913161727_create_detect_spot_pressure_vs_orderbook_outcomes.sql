-- Exportiert aus supabase_migrations.schema_migrations (20260913161727 create_detect_spot_pressure_vs_orderbook_outcomes)

-- Vierter directional-Paar in der signal_outcomes-Pipeline (nach den 3 aus
-- Rueckblick Phase 5): Spot-Pressure vs. Orderbuch, siehe
-- lib/divergenceRadar.ts::computeSpotPressureVsOrderbookDivergence.
-- RESISTANCE_AHEAD/SUPPORT_AHEAD sind wie ABSORPTION_BULLISH/BEARISH bereits
-- per Namenskonvention gerichtet -- exakt dieselbe Begruendung wie fuer
-- Spot-Pressure-Absorption in SIGNAL-REVIEW-PHASE5_2026-09-10.md Abschnitt 2.
create or replace function public.detect_spot_pressure_vs_orderbook_outcomes()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.spot_pressure_vs_orderbook,
      case s.spot_pressure_vs_orderbook
        when 'RESISTANCE_AHEAD' then 'spot_pressure_orderbook_resistance'
        when 'SUPPORT_AHEAD' then 'spot_pressure_orderbook_support'
        else null
      end as signal_type,
      case s.spot_pressure_vs_orderbook
        when 'RESISTANCE_AHEAD' then 'bearish'
        when 'SUPPORT_AHEAD' then 'bullish'
        else null
      end as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.spot_pressure_vs_orderbook) over (order by r.id) as prev_value
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and spot_pressure_vs_orderbook is distinct from prev_value and price is not null
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
$function$;

revoke all on function public.detect_spot_pressure_vs_orderbook_outcomes() from public, anon, authenticated;
