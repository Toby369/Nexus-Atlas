-- Exportiert aus supabase_migrations.schema_migrations (20260910031650 create_detect_core_engine_outcomes)


-- Periodischer KI-Rueckblick Phase 4 (10.09.2026): erste "Kern-Engine"-
-- Signal-Gruppe -- der 14-Faktoren-Gesamtzustand (market_states.overall_state)
-- und das 5-Saeulen-Regime (market_state_matrix.regime). Beide waren bisher
-- noch nie gegen echte Preis-Outcomes geprueft (siehe Plan vom 09.09.2026,
-- Tabelle "Kern-Engines ... Nein -- nur der 4H-Struktur-Filter").
--
-- Nutzt dieselbe signal_outcomes/signal_stats_results/signal_review-
-- Pipeline aus Phase 1-3 UNVERAENDERT weiter -- category/signal_type sind
-- dort bewusst offener Text, keine feste Enum-Liste, damit neue Gruppen
-- keine Schema-Aenderung brauchen.
--
-- direction_expected nur fuer eindeutig gerichtete Zustaende:
--   - overall_state: BULLISH -> bullish, BEARISH -> bearish. NEUTRAL/MIXED/
--     INSUFFICIENT_DATA feuern KEIN Signal (keine gerichtete Aussage).
--   - regime: TREND_EXPANSION_BULLISH -> bullish, TREND_EXPANSION_BEARISH
--     -> bearish. VOLA_SQUEEZE_RANGING/UNRESOLVED_NEUTRAL feuern KEIN
--     Signal (bewusst zurueckgestellt -- waeren Magnitude-Kandidaten wie
--     die Risk-Faktoren, aber das ist nicht Teil dieser Phase).
--
-- Transition-Erkennung wie bei den Warn-Mustern/Risk-Faktoren: nur der
-- erste Bar eines neuen gerichteten Zustands zaehlt (LAG-Vergleich),
-- sonst wuerde ein tagelang anhaltender BULLISH-Zustand bei jedem 15-Min-
-- Cron-Lauf erneut gezaehlt.
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
    where direction_expected is not null
      and overall_state is distinct from prev_overall_state
      and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'core_engine',
    'overall_state',
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

comment on function public.detect_overall_state_outcomes is
  'Periodischer KI-Rueckblick Phase 4 (10.09.2026): backfillt/trackt Transitionen des 14-Faktoren-Gesamtzustands (market_states.overall_state) in signal_outcomes, nur BULLISH/BEARISH, nur beim ERSTEN Bar einer neuen gerichteten Phase. x Horizonte [4,12,24]h. Idempotent.';

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
    where direction_expected is not null
      and regime is distinct from prev_regime
      and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'core_engine',
    'regime_matrix',
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

comment on function public.detect_regime_matrix_outcomes is
  'Periodischer KI-Rueckblick Phase 4 (10.09.2026): backfillt/trackt Transitionen des 5-Saeulen-Regimes (market_state_matrix.regime) in signal_outcomes, nur TREND_EXPANSION_BULLISH/BEARISH, nur beim ERSTEN Bar einer neuen gerichteten Phase. Preis kommt aus candles (Binance BTCUSDT 1H) an derselben Stunde, da market_state_matrix selbst keine Preis-Spalte fuehrt. x Horizonte [4,12,24]h. Idempotent.';

revoke execute on function public.detect_overall_state_outcomes() from public;
revoke execute on function public.detect_regime_matrix_outcomes() from public;
