-- Exportiert aus supabase_migrations.schema_migrations (20260827164348 create_research_factor_coverage_audit)


-- Phase 6, Section 4: Data Coverage Audit. Nutzt bewusst backtest_states
-- (v2, 1D, point-in-time-sicher) als Quelle statt die Rohtabellen einzeln
-- neu abzufragen -- das reflektiert exakt "war dieser Faktor zu diesem
-- historischen Zeitpunkt fuer die Produktions-Engine verfuegbar (inkl.
-- Freshness-Fenster)", nicht nur "existiert irgendeine Rohzeile". Baut auf
-- Phase 4 auf statt sie zu duplizieren.
--
-- Bewusst auf TRAIN+VALIDATION beschraenkt (Testset-Schutz, Section 2) --
-- reine Coverage-Statistik ist zwar kein Feature-/Threshold-Selection,
-- wird hier trotzdem konservativ behandelt und via
-- research_log_test_access() protokolliert, sobald TEST fuer eine reine
-- Existenzpruefung mit einbezogen wird (siehe research_factor_coverage_full).
create or replace function public.research_factor_coverage(p_include_test boolean default false)
returns table (
  factor_name text,
  domain text,
  first_available timestamptz,
  last_available timestamptz,
  total_observations integer,
  window_rows integer,
  coverage_pct numeric,
  longest_continuous_days integer,
  max_gap_days numeric
)
language plpgsql
stable
as $$
declare
  v_factors text[] := array['structure','momentum','cvd','oi_price','trend_strength','trend_regime','vwap_position','basis','funding','positioning','orderbook','options','macro','sentiment'];
  v_domain_map jsonb := '{
    "structure":"market_structure","vwap_position":"market_structure",
    "momentum":"momentum_trend","trend_strength":"momentum_trend","trend_regime":"momentum_trend",
    "cvd":"order_flow","orderbook":"order_flow",
    "oi_price":"derivatives_leverage","positioning":"derivatives_leverage","funding":"derivatives_leverage","basis":"derivatives_leverage",
    "options":"options","macro":"macro_liquidity","sentiment":"sentiment"
  }'::jsonb;
  v_test_start date := '2026-07-08';
  v_test_end date := '2026-08-26';
  f text;
begin
  if p_include_test then
    perform public.research_log_test_access('research_factor_coverage: TEST-Zeitraum in reine Existenz-/Coverage-Pruefung einbezogen (keine Label-/Return-Information)', null, null);
  end if;

  foreach f in array v_factors loop
    return query
    with rows_in_window as (
      select bs.candle_open_time,
        (bs.factors->f->>'value') is not null as has_value
      from backtest_states bs
      where bs.interval = '1d' and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
        and (p_include_test or bs.candle_open_time::date < v_test_start)
    ),
    available as (
      select candle_open_time from rows_in_window where has_value
    ),
    gaps as (
      select candle_open_time,
        candle_open_time - lag(candle_open_time) over (order by candle_open_time) as gap
      from available
    ),
    runs as (
      select candle_open_time,
        candle_open_time - (row_number() over (order by candle_open_time))::int * interval '1 day' as grp
      from available
    ),
    run_lengths as (
      select count(*) as len from runs group by grp
    )
    select
      f,
      v_domain_map->>f,
      (select min(candle_open_time) from available),
      (select max(candle_open_time) from available),
      (select count(*) from available)::int,
      (select count(*) from rows_in_window)::int,
      round(100.0 * (select count(*) from available) / nullif((select count(*) from rows_in_window),0), 1),
      coalesce((select max(len) from run_lengths), 0)::int,
      coalesce((select extract(epoch from max(gap))/86400 from gaps), null);
  end loop;
end;
$$;

revoke all on function public.research_factor_coverage(boolean) from public;
grant execute on function public.research_factor_coverage(boolean) to anon, authenticated, service_role;
