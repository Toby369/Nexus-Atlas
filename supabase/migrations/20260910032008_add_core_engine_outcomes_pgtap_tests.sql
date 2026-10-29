-- Exportiert aus supabase_migrations.schema_migrations (20260910032008 add_core_engine_outcomes_pgtap_tests)


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
  return next plan(8);

  -- 1) Idempotenz beider neuen Detection-Funktionen.
  select count(*) into cnt_before from public.signal_outcomes where category = 'core_engine';
  perform public.detect_overall_state_outcomes();
  perform public.detect_regime_matrix_outcomes();
  select count(*) into cnt_after from public.signal_outcomes where category = 'core_engine';
  return next is(cnt_after, cnt_before, 'Wiederholter Kern-Engine-Detection-Lauf ist idempotent');

  -- 2) Richtung ist im signal_type kodiert (Regressionstest fuer den
  --    ON-CONFLICT-Kollisionsbug: overall_state_bullish/bearish sind
  --    eigenstaendige signal_type-Werte, kein gemeinsamer 'overall_state'
  --    mit wechselndem direction_expected).
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

  -- 3) Anti-Spam: "overall_state_bullish" ist ueber deutlich mehr
  --    market_states-Zeilen aktiv (BULLISH) als es Instanzen gibt.
  select count(*) into bullish_active_rows from public.market_states where overall_state = 'BULLISH';
  select count(*) into bullish_instances
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bullish' and horizon_hours = 4;
  return next cmp_ok(
    bullish_instances, '<', bullish_active_rows,
    'Transition-Erkennung zaehlt eine BULLISH-Phase einmal, nicht pro 15-Min-Zeile'
  );

  -- 4) compute_signal_stats() darf NICHT mehr an der urspruenglichen
  --    ON-CONFLICT-Kollision scheitern (beide Richtungen desselben
  --    signal_type_prefix in derselben (window, category, horizon)-Gruppe).
  return next lives_ok(
    'select public.compute_signal_stats(''90d'')',
    'compute_signal_stats() scheitert nicht an bullish/bearish-Kollision (Regressionstest)'
  );

  -- 5) regime_matrix-Preis kommt korrekt aus candles (kein NULL-Preis in
  --    den gespeicherten Zeilen trotz LEFT JOIN in der Detection-Funktion).
  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type like 'regime_matrix_%' and price_at_signal is null;
  return next is(bad_count, 0, 'regime_matrix-Signale haben nie einen NULL-Preis (LEFT JOIN korrekt gefiltert)');

  return next finish();
end;
$function$;

comment on function public.run_core_engine_outcomes_tests is
  'pgTAP-Tests fuer den periodischen KI-Rueckblick Phase 4 (10.09.2026): Kern-Engine-Detection (overall_state/regime_matrix) -- Idempotenz, Richtungs-Kodierung im signal_type (Regressionstest fuer den urspruenglichen ON-CONFLICT-Kollisionsbug), Anti-Spam-Transitionserkennung, compute_signal_stats()-Regressionstest.';
