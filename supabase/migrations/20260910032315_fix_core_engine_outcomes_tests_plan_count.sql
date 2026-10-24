-- Exportiert aus supabase_migrations.schema_migrations (20260910032315 fix_core_engine_outcomes_tests_plan_count)


create or replace function public.run_core_engine_outcomes_tests()
returns setof text
language plpgsql
as $function$
declare
  cnt_before int;
  cnt_after int;
  bad_count int;
  bullish_active_rows int;
  bullish_instances int;
begin
  return next plan(7);

  select count(*) into cnt_before from public.signal_outcomes where category = 'core_engine';
  perform public.detect_overall_state_outcomes();
  perform public.detect_regime_matrix_outcomes();
  select count(*) into cnt_after from public.signal_outcomes where category = 'core_engine';
  return next is(cnt_after, cnt_before, 'Wiederholter Kern-Engine-Detection-Lauf ist idempotent');

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bullish' and direction_expected <> 'bullish';
  return next is(bad_count, 0, 'overall_state_bullish hat immer direction_expected=bullish');

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bearish' and direction_expected <> 'bearish';
  return next is(bad_count, 0, 'overall_state_bearish hat immer direction_expected=bearish');

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type like 'regime_matrix_%'
    and direction_expected is distinct from replace(signal_type, 'regime_matrix_', '');
  return next is(bad_count, 0, 'regime_matrix_bullish/bearish hat immer die passende direction_expected');

  select count(*) into bullish_active_rows from public.market_states where overall_state = 'BULLISH';
  select count(*) into bullish_instances
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bullish' and horizon_hours = 4;
  return next cmp_ok(
    bullish_instances, '<', bullish_active_rows,
    'Transition-Erkennung zaehlt eine BULLISH-Phase einmal, nicht pro 15-Min-Zeile'
  );

  return next lives_ok(
    'select public.compute_signal_stats(''90d'')',
    'compute_signal_stats() scheitert nicht an bullish/bearish-Kollision (Regressionstest)'
  );

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type like 'regime_matrix_%' and price_at_signal is null;
  return next is(bad_count, 0, 'regime_matrix-Signale haben nie einen NULL-Preis (LEFT JOIN korrekt gefiltert)');

  return next finish();
end;
$function$;
