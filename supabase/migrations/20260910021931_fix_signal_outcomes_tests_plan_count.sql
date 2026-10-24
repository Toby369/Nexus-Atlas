-- Exportiert aus supabase_migrations.schema_migrations (20260910021931 fix_signal_outcomes_tests_plan_count)


create or replace function public.run_signal_outcomes_tests()
returns setof text
language plpgsql
as $function$
declare
  cnt_before int;
  cnt_after int;
  fragile_instances int;
  fragile_active_rows int;
  bad_hit_count int;
  bad_return_count int;
  premature_fill_count int;
  dup_count int;
begin
  return next plan(21);

  return next is(public.tv_infer_signal_direction('FAIR_VALUE_GAP_BULLISH'), 'bullish', 'FVG bullish -> bullish');
  return next is(public.tv_infer_signal_direction('ORDER_BLOCK_BEARISH'), 'bearish', 'Order Block bearish -> bearish');
  return next is(public.tv_infer_signal_direction('VOLUME_EXPANSION_BULL'), 'bullish', '_BULL-Kurzform -> bullish');
  return next is(public.tv_infer_signal_direction('VOLUME_EXPANSION_BEAR'), 'bearish', '_BEAR-Kurzform -> bearish');
  return next is(public.tv_infer_signal_direction('LIQUIDITY_SWEEP_LOW'), 'bullish', 'Sweep tief = bullischer Reversal-Hinweis');
  return next is(public.tv_infer_signal_direction('LIQUIDITY_SWEEP_HIGH'), 'bearish', 'Sweep hoch = baerischer Reversal-Hinweis');
  return next is(public.tv_infer_signal_direction('VWAP_STRETCH_LO'), 'bullish', 'VWAP-Stretch tief = bullischer Erschoepfungs-Hinweis');
  return next is(public.tv_infer_signal_direction('VWAP_STRETCH_HI'), 'bearish', 'VWAP-Stretch hoch = baerischer Erschoepfungs-Hinweis');
  return next is(public.tv_infer_signal_direction('SOME_FUTURE_SIGNAL'), null, 'Unbekannter Typ -> NULL statt geratener Richtung');
  return next is(public.tv_infer_signal_direction('fair_value_gap_bullish'), 'bullish', 'Gross-/Kleinschreibungs-unabhaengig');

  select count(*) into cnt_before from public.signal_outcomes;
  perform public.detect_tradingview_signal_outcomes();
  perform public.detect_warning_pattern_outcomes();
  perform public.detect_risk_factor_outcomes();
  select count(*) into cnt_after from public.signal_outcomes;
  return next is(cnt_after, cnt_before, 'Wiederholter Detection-Lauf ohne neue Quellzeilen ist idempotent (keine Duplikate)');

  insert into public.signal_outcomes
    (category, signal_type, direction_expected, fired_at, price_at_signal, horizon_hours, source_table, source_id)
  values
    ('test_fixture', 'signal_a', 'bullish', now() - interval '1 hour', 100, 4, 'test_fixture', 'shared-id'),
    ('test_fixture', 'signal_b', 'bearish', now() - interval '1 hour', 100, 4, 'test_fixture', 'shared-id')
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;
  select count(*) into cnt_after from public.signal_outcomes where source_table = 'test_fixture';
  return next is(cnt_after, 2, 'Zwei Signal-Typen an derselben source_id kollidieren NICHT mehr (Bugfix-Regressionstest)');
  delete from public.signal_outcomes where source_table = 'test_fixture';

  select count(*) into fragile_active_rows
  from public.market_states
  where exists (select 1 from jsonb_array_elements(patterns) e where e->>'name' = 'Fragile Bullish');
  select count(*) into fragile_instances
  from public.signal_outcomes
  where category = 'warning_pattern' and signal_type = 'Fragile Bullish' and horizon_hours = 4;
  return next cmp_ok(
    fragile_instances, '<', fragile_active_rows,
    'Transition-Erkennung zaehlt eine zusammenhaengende Aktiv-Phase einmal, nicht pro 15-Min-Zeile'
  );

  select count(*) into bad_return_count
  from public.signal_outcomes
  where filled_at is not null
    and abs(return_pct - ((outcome_price - price_at_signal) / price_at_signal) * 100) > 0.0001;
  return next is(bad_return_count, 0, 'return_pct entspricht ueberall der Formel (outcome-price)/price*100');

  select count(*) into bad_hit_count
  from public.signal_outcomes
  where filled_at is not null and direction_expected = 'bullish' and hit is distinct from (outcome_price > price_at_signal);
  return next is(bad_hit_count, 0, 'hit=bullish stimmt ueberall mit outcome_price > price_at_signal ueberein');

  select count(*) into bad_hit_count
  from public.signal_outcomes
  where filled_at is not null and direction_expected = 'bearish' and hit is distinct from (outcome_price < price_at_signal);
  return next is(bad_hit_count, 0, 'hit=bearish stimmt ueberall mit outcome_price < price_at_signal ueberein');

  select count(*) into bad_hit_count
  from public.signal_outcomes
  where filled_at is not null and direction_expected is null and hit is not null;
  return next is(bad_hit_count, 0, 'hit bleibt NULL, wenn direction_expected NULL ist (kein erfundener Treffertest)');

  select count(*) into premature_fill_count
  from public.signal_outcomes
  where filled_at is not null and outcome_at < fired_at + (horizon_hours || ' hours')::interval;
  return next is(premature_fill_count, 0, 'outcome_at liegt nie vor dem Zielzeitpunkt (fired_at + horizon) -- kein Blick in die falsche Kerze');

  select count(*) into dup_count
  from (
    select source_table, source_id, signal_type, horizon_hours, count(*) c
    from public.signal_outcomes
    group by 1,2,3,4
    having count(*) > 1
  ) d;
  return next is(dup_count, 0, 'Keine doppelten (source_table, source_id, signal_type, horizon_hours)-Kombinationen');

  return next is(
    (select count(*)::int from public.signal_outcomes where category = '' or signal_type = ''),
    0,
    'category/signal_type sind nie leer'
  );

  return next is(
    (select count(*)::int from public.signal_outcomes where direction_expected is not null and direction_expected not in ('bullish', 'bearish')),
    0,
    'direction_expected ist immer bullish/bearish oder NULL (Check-Constraint)'
  );

  return next finish();
end;
$function$;
