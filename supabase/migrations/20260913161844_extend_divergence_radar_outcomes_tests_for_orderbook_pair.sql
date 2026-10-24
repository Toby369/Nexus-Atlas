-- Exportiert aus supabase_migrations.schema_migrations (20260913161844 extend_divergence_radar_outcomes_tests_for_orderbook_pair)

CREATE OR REPLACE FUNCTION public.run_divergence_radar_outcomes_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  id1 bigint;
  id2 bigint;
  id3 bigint;
  id4 bigint;
  cnt int;
  st text;
  dir text;
begin
  return next plan(11);

  -- Fixtures: zwei aufeinanderfolgende Snapshots mit identischem
  -- spot_pressure_vs_price -- nur der erste darf ein Signal feuern
  -- (Anti-Spam-Transitionserkennung).
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price)
  values (79000, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'ABSORPTION_BULLISH',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE')
  returning id into id1;
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price)
  values (79050, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'ABSORPTION_BULLISH',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE')
  returning id into id2;

  perform public.detect_spot_pressure_absorption_outcomes();

  select count(*) into cnt from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id in (id1::text, id2::text);
  return next is(cnt, 3, 'Nur der ERSTE von zwei identischen ABSORPTION_BULLISH-Snapshots feuert (3 = 1 Instanz x 3 Horizonte)');

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id1::text and horizon_hours = 4;
  return next is(st, 'spot_pressure_absorption_bullish', 'ABSORPTION_BULLISH -> signal_type spot_pressure_absorption_bullish');
  return next is(dir, 'bullish', 'ABSORPTION_BULLISH -> direction_expected bullish');

  -- Onchain-vs-Preis: PRICE_HIGH_SOPR_LOSS -> bearish.
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price)
  values (81000, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'PRICE_HIGH_SOPR_LOSS')
  returning id into id3;

  perform public.detect_onchain_vs_price_outcomes();

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id3::text and horizon_hours = 4;
  return next is(st, 'onchain_vs_price_bearish', 'PRICE_HIGH_SOPR_LOSS -> signal_type onchain_vs_price_bearish');
  return next is(dir, 'bearish', 'PRICE_HIGH_SOPR_LOSS -> direction_expected bearish');

  delete from public.signal_outcomes where source_table = 'divergence_radar_snapshots' and source_id = id3::text;
  delete from public.divergence_radar_snapshots where id = id3;

  -- RSI/MACD-Divergenz vs. Trendkontext: bullish + GEGEN_INTAKTEN_TREND.
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     rsi_macd_divergence_direction, onchain_vs_price)
  values (79500, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'GEGEN_INTAKTEN_TREND', 'bullish', 'NOT_COMPARABLE')
  returning id into id3;

  perform public.detect_rsi_divergence_vs_trend_outcomes();

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id3::text and horizon_hours = 4;
  return next is(st, 'rsi_divergence_bullish_gegentrend', 'bullish+GEGEN_INTAKTEN_TREND -> signal_type rsi_divergence_bullish_gegentrend');
  return next is(dir, 'bullish', 'bullish+GEGEN_INTAKTEN_TREND -> direction_expected bullish');

  -- Spot-Pressure vs. Orderbuch: RESISTANCE_AHEAD -> bearish.
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price, spot_pressure_vs_orderbook)
  values (80200, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'RESISTANCE_AHEAD')
  returning id into id4;

  perform public.detect_spot_pressure_vs_orderbook_outcomes();

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id4::text and horizon_hours = 4;
  return next is(st, 'spot_pressure_orderbook_resistance', 'RESISTANCE_AHEAD -> signal_type spot_pressure_orderbook_resistance');
  return next is(dir, 'bearish', 'RESISTANCE_AHEAD -> direction_expected bearish');

  -- Idempotenz: zweiter Lauf ohne neue Snapshots aendert nichts.
  select count(*) into cnt from public.signal_outcomes;
  perform public.detect_spot_pressure_absorption_outcomes();
  perform public.detect_onchain_vs_price_outcomes();
  perform public.detect_rsi_divergence_vs_trend_outcomes();
  perform public.detect_spot_pressure_vs_orderbook_outcomes();
  return next is(
    (select count(*)::int from public.signal_outcomes), cnt,
    'Wiederholter Divergenz-Radar-Detection-Lauf ist idempotent'
  );

  -- Aufraeumen -- Test-Fixtures duerfen keine echten Daten verunreinigen.
  delete from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id in (id1::text, id2::text, id3::text, id4::text);
  delete from public.divergence_radar_snapshots where id in (id1, id2, id3, id4);

  select count(*)::int into cnt from public.divergence_radar_snapshots where id in (id1, id2, id3, id4);
  return next is(cnt, 0, 'Test-Fixtures vollstaendig aufgeraeumt');

  return next finish();
end;
$function$;
