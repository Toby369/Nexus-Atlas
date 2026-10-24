-- Exportiert aus supabase_migrations.schema_migrations (20260913155726 create_regime_extend_activation_round7_warn_muster)

create or replace function public.research_regime_extend_activation_round7()
returns void
language plpgsql
as $function$
begin
  -- Kandidat 1: Fragile Bullish (structure=bullish, cvd=falling) -- NUR UP.
  -- 1:1 aus compute-market-state, beide Werte aus derselben 1h-Zeile.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Fragile Bullish', 'UP', e.outcome,
    coalesce((
      select m.structure_trend = 'bullish' and m.cvd_trend = 'falling'
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: Distribution Warning (Preis < 0,5xATR14 vom 20er-Hoch, cvd=falling) -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Distribution Warning', 'DOWN', e.outcome,
    coalesce((
      select (m.range_high_20 - m.close_price) < 0.5 * m.atr_14 and m.cvd_trend = 'falling'
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= e.evaluation_time
        and m.range_high_20 is not null and m.atr_14 is not null and m.close_price is not null
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;
