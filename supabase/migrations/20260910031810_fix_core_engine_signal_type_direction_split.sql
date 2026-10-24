-- Exportiert aus supabase_migrations.schema_migrations (20260910031810 fix_core_engine_signal_type_direction_split)


-- Bugfix: 'overall_state'/'regime_matrix' als EIN signal_type fuer BEIDE
-- Richtungen (anders als TradingView-Alerts/Warn-Muster, wo Richtung schon
-- im Namen steckt) kollidierte in compute_signal_stats(): die
-- Unique-Constraint auf signal_stats_results ist (window_label, category,
-- signal_type, horizon_hours) OHNE direction_expected -- ein bullish- und
-- ein bearish-Grüppchen desselben signal_type versuchten denselben Schlüssel
-- zu befuellen ("ON CONFLICT DO UPDATE command cannot affect row a second
-- time"). Loesung: Richtung direkt in signal_type kodieren, gleiche
-- Konvention wie ueberall sonst (z.B. FAIR_VALUE_GAP_BULLISH/BEARISH).
delete from public.signal_outcomes
where source_table in ('market_states', 'market_state_matrix')
  and category = 'core_engine';

create or replace function public.detect_overall_state_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with state_rows as (
    select
      ms.id,
      ms.timestamp_utc,
      ms.overall_state,
      case ms.overall_state
        when 'BULLISH' then 'overall_state_bullish'
        when 'BEARISH' then 'overall_state_bearish'
        else null
      end as signal_type,
      case ms.overall_state
        when 'BULLISH' then 'bullish'
        when 'BEARISH' then 'bearish'
        else null
      end as direction_expected,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price
    from public.market_states ms
  ),
  transitions as (
    select
      sr.*,
      lag(sr.overall_state) over (order by sr.id) as prev_overall_state
    from state_rows sr
  ),
  fired as (
    select * from transitions
    where signal_type is not null
      and overall_state is distinct from prev_overall_state
      and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'core_engine',
    f.signal_type,
    f.direction_expected,
    f.timestamp_utc,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.detect_regime_matrix_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with matrix_rows as (
    select
      mm.id,
      mm.timestamp_utc,
      mm.regime,
      case mm.regime
        when 'TREND_EXPANSION_BULLISH' then 'regime_matrix_bullish'
        when 'TREND_EXPANSION_BEARISH' then 'regime_matrix_bearish'
        else null
      end as signal_type,
      case mm.regime
        when 'TREND_EXPANSION_BULLISH' then 'bullish'
        when 'TREND_EXPANSION_BEARISH' then 'bearish'
        else null
      end as direction_expected,
      c.close as close_price
    from public.market_state_matrix mm
    left join public.candles c
      on c.exchange = 'binance'
      and c.symbol = 'BTCUSDT'
      and c.interval = '1h'
      and c.open_time = mm.timestamp_utc
    where mm.symbol = 'BTCUSDT' and mm.interval = '1h'
  ),
  transitions as (
    select
      mr.*,
      lag(mr.regime) over (order by mr.id) as prev_regime
    from matrix_rows mr
  ),
  fired as (
    select * from transitions
    where signal_type is not null
      and regime is distinct from prev_regime
      and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'core_engine',
    f.signal_type,
    f.direction_expected,
    f.timestamp_utc,
    f.close_price,
    h.horizon_hours,
    'market_state_matrix',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.detect_overall_state_outcomes is
  'Periodischer KI-Rueckblick Phase 4 (10.09.2026): backfillt/trackt Transitionen des 14-Faktoren-Gesamtzustands (market_states.overall_state) in signal_outcomes als overall_state_bullish/overall_state_bearish (Richtung im signal_type kodiert, gleiche Konvention wie TradingView-Alerts -- vermeidet Konflikt in compute_signal_stats, da die Unique-Constraint dort keine direction_expected-Spalte hat). Nur beim ERSTEN Bar einer neuen gerichteten Phase. x Horizonte [4,12,24]h. Idempotent.';

comment on function public.detect_regime_matrix_outcomes is
  'Periodischer KI-Rueckblick Phase 4 (10.09.2026): backfillt/trackt Transitionen des 5-Saeulen-Regimes (market_state_matrix.regime) in signal_outcomes als regime_matrix_bullish/regime_matrix_bearish (Richtung im signal_type kodiert, siehe detect_overall_state_outcomes-Kommentar). Preis aus candles (Binance BTCUSDT 1H) an derselben Stunde. x Horizonte [4,12,24]h. Idempotent.';
