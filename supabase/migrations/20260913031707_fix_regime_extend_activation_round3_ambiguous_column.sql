-- Exportiert aus supabase_migrations.schema_migrations (20260913031707 fix_regime_extend_activation_round3_ambiguous_column)


create or replace function research_regime_extend_activation_round3() returns void
language plpgsql
as $function$
begin
  -- Kandidat 1: Preis > Top-CPR -> UP (nur UP, siehe Vorregistrierung).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPR-Position (Preis > Top)', 'UP', e.outcome,
    coalesce(
      (select c.close from candles c
       where c.symbol = 'BTCUSDT' and c.interval = '1h' and c.exchange = 'binance'
         and c.open_time <= e.evaluation_time
       order by c.open_time desc limit 1)
      >
      (select (2 * ((d.high + d.low + d.close) / 3.0) - (d.high + d.low) / 2.0)
       from candles d
       where d.symbol = 'BTCUSDT' and d.interval = '1d' and d.exchange = 'binance'
         and d.close_time <= e.evaluation_time
       order by d.close_time desc limit 1),
      false
    )
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: Preis < Bottom-CPR -> DOWN (nur DOWN, siehe Vorregistrierung).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPR-Position (Preis < Bottom)', 'DOWN', e.outcome,
    coalesce(
      (select c.close from candles c
       where c.symbol = 'BTCUSDT' and c.interval = '1h' and c.exchange = 'binance'
         and c.open_time <= e.evaluation_time
       order by c.open_time desc limit 1)
      <
      (select (d.high + d.low) / 2.0
       from candles d
       where d.symbol = 'BTCUSDT' and d.interval = '1d' and d.exchange = 'binance'
         and d.close_time <= e.evaluation_time
       order by d.close_time desc limit 1),
      false
    )
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 3: CPR-Breite eng (unterstes Tertil der letzten 20 Tageskerzen
  -- VOR der aktuellen CPR-Tageskerze) -> BEIDE Richtungen, siehe Vorregistrierung.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPR-Breite eng', dir.direction, e.outcome,
    coalesce((
      with cur as (
        select
          ((2 * ((high + low + close) / 3.0) - (high + low) / 2.0) - (high + low) / 2.0)
            / nullif((high + low + close) / 3.0, 0) * 100 as width_pct,
          close_time as cur_close_time
        from candles
        where symbol = 'BTCUSDT' and interval = '1d' and exchange = 'binance'
          and close_time <= e.evaluation_time
        order by close_time desc
        limit 1
      ),
      recent as (
        select
          ((2 * ((candles.high + candles.low + candles.close) / 3.0) - (candles.high + candles.low) / 2.0) - (candles.high + candles.low) / 2.0)
            / nullif((candles.high + candles.low + candles.close) / 3.0, 0) * 100 as width_pct
        from candles, cur
        where candles.symbol = 'BTCUSDT' and candles.interval = '1d' and candles.exchange = 'binance'
          and candles.close_time < cur.cur_close_time
        order by candles.close_time desc
        limit 20
      )
      select cur.width_pct <= (select percentile_cont(0.3333) within group (order by recent.width_pct) from recent)
      from cur
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;
