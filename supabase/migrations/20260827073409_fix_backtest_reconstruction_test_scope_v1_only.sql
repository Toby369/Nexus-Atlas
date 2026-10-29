-- Exportiert aus supabase_migrations.schema_migrations (20260827073409 fix_backtest_reconstruction_test_scope_v1_only)


-- Test 3 pruefte "unreconstructed_factors ist ueberall die v1-5er-Liste"
-- ungefiltert -- seit backtest_reconstruct_1h_states_v2() existiert und
-- korrekt ein LEERES Array schreibt (siehe run_lookahead_protection_tests
-- Test 6), ist das kein Bug, sondern der Test war zu weit gefasst. Fix:
-- explizit auf architecture_version='experimental_domain_v1_phase3'
-- einschraenken -- das ist genau das, was dieser Test eigentlich pruefen
-- sollte (die v1-Dokumentationsluecke bleibt fuer v1-Zeilen bestehen,
-- unabhaengig davon, dass v2 sie inzwischen behoben hat).
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

  select count(*) into v_total from backtest_states where architecture_version = 'experimental_domain_v1_phase3';
  return next cmp_ok(v_total, '>', 250, 'backtest_states (v1) enthaelt Rekonstruktionen fuer die verfuegbare 1H-Historie (>250 Zeilen)');

  select count(*) into v_bad_keys
  from backtest_states
  where (select count(*) from jsonb_object_keys(factors)) <> 14;
  return next is(v_bad_keys, 0, 'Jede backtest_states-Zeile hat exakt 14 Faktor-Keys, wie in compute-market-state');

  select count(*) into v_bad_unrecon
  from backtest_states
  where architecture_version = 'experimental_domain_v1_phase3'
    and unreconstructed_factors <> array['positioning','orderbook','options','macro','sentiment'];
  return next is(v_bad_unrecon, 0, 'v1: unreconstructed_factors ist fuer jede Zeile die dokumentierte, identische 5er-Liste');

  select count(*) into v_future_leak
  from backtest_states bs
  where bs.architecture_version = 'experimental_domain_v1_phase3'
    and (bs.factors->'funding'->>'value') is not null
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

  perform public.backtest_reconstruct_1h_states(null, v_fixed_to);
  v_second_run_inserted := public.backtest_reconstruct_1h_states(null, v_fixed_to);
  return next is(v_second_run_inserted, 0, 'backtest_reconstruct_1h_states() (v1) ist idempotent -- zweiter Aufruf auf demselben Zeitfenster fuegt 0 Zeilen ein');

  return next finish();
end;
$$;
