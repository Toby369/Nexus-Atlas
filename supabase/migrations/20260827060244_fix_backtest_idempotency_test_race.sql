-- Exportiert aus supabase_migrations.schema_migrations (20260827060244 fix_backtest_idempotency_test_race)


-- Test 6 schlug fehl, weil zwischen den beiden Aufrufen im Test eine neue
-- market_features-Zeile eintraf (Cron laeuft alle 15 Min) -- das war ein
-- Race im TEST (ungebundener Zeitraum), kein Bug in
-- backtest_reconstruct_1h_states() selbst (ON CONFLICT DO NOTHING schuetzt
-- bereits korrekt). Fix: beide Aufrufe auf ein bei Testbeginn fixiertes
-- p_to begrenzen, damit zwischen den zwei Laeufen garantiert keine neue
-- Zeile in den betrachteten Zeitraum fallen kann.
create or replace function public.run_backtest_reconstruction_tests()
returns setof text
language plpgsql
as $$
declare
  v_count_before int;
  v_count_after int;
  v_bad_keys int;
  v_bad_unrecon int;
  v_future_leak int;
  v_valid_states int;
  v_total int;
  v_fixed_to timestamptz := now() - interval '10 minutes';
  v_second_run_inserted int;
begin
  return next plan(6);

  select count(*) into v_total from backtest_states;
  return next cmp_ok(v_total, '>', 250, 'backtest_states enthaelt Rekonstruktionen fuer die verfuegbare 1H-Historie (>250 Zeilen)');

  select count(*) into v_bad_keys
  from backtest_states
  where (select count(*) from jsonb_object_keys(factors)) <> 14;
  return next is(v_bad_keys, 0, 'Jede backtest_states-Zeile hat exakt 14 Faktor-Keys, wie in compute-market-state');

  select count(*) into v_bad_unrecon
  from backtest_states
  where unreconstructed_factors <> array['positioning','orderbook','options','macro','sentiment'];
  return next is(v_bad_unrecon, 0, 'unreconstructed_factors ist fuer jede Zeile die dokumentierte, identische 5er-Liste');

  select count(*) into v_future_leak
  from backtest_states bs
  where (bs.factors->'funding'->>'value') is not null
    and exists (
      select 1 from market_snapshots ms
      where ms.status = 'ok' and ms.funding_rate is not null
        and ms.timestamp_utc > bs.timestamp_utc
        and ms.timestamp_utc = (
          select max(timestamp_utc) from market_snapshots ms2
          where ms2.exchange = ms.exchange and ms2.status='ok' and ms2.funding_rate is not null
            and ms2.timestamp_utc <= bs.timestamp_utc
        )
    );
  return next is(v_future_leak, 0, 'Funding-Rekonstruktion nutzt nachweislich keine Daten nach dem jeweiligen Kerzen-Schluss (kein Look-ahead)');

  select count(*), count(*) filter (where domain_result->>'overall_state' in ('BULLISH','BEARISH','NEUTRAL','MIXED','INSUFFICIENT_DATA'))
  into v_total, v_valid_states
  from backtest_states;
  return next is(v_valid_states, v_total, 'domain_result.overall_state ist immer einer der 5 definierten Zustaende');

  -- Idempotenz auf einem bei Testbeginn fixierten Zeitfenster (p_to), damit
  -- kein neu eintreffender Cron-Lauf zwischen den beiden Aufrufen den
  -- betrachteten Datenbestand veraendern kann.
  perform public.backtest_reconstruct_1h_states(null, v_fixed_to);
  v_second_run_inserted := public.backtest_reconstruct_1h_states(null, v_fixed_to);
  return next is(v_second_run_inserted, 0, 'backtest_reconstruct_1h_states() ist idempotent -- zweiter Aufruf auf demselben Zeitfenster fuegt 0 Zeilen ein');

  return next finish();
end;
$$;
