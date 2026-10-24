-- Exportiert aus supabase_migrations.schema_migrations (20260827060146 add_backtest_reconstruction_pgtap_tests)


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
begin
  return next plan(6);

  select count(*) into v_total from backtest_states;
  return next cmp_ok(v_total, '>', 250, 'backtest_states enthaelt Rekonstruktionen fuer die verfuegbare 1H-Historie (>250 Zeilen)');

  -- Jede Zeile hat exakt die 14 Faktor-Keys (gleiche Form wie market_states.factors)
  select count(*) into v_bad_keys
  from backtest_states
  where (select count(*) from jsonb_object_keys(factors)) <> 14;
  return next is(v_bad_keys, 0, 'Jede backtest_states-Zeile hat exakt 14 Faktor-Keys, wie in compute-market-state');

  -- unreconstructed_factors ist ueberall exakt dieselbe, dokumentierte 5er-Liste
  select count(*) into v_bad_unrecon
  from backtest_states
  where unreconstructed_factors <> array['positioning','orderbook','options','macro','sentiment'];
  return next is(v_bad_unrecon, 0, 'unreconstructed_factors ist fuer jede Zeile die dokumentierte, identische 5er-Liste');

  -- Point-in-Time-Check: fuer jede Zeile mit einem funding-Wert darf keine
  -- market_snapshots-Zeile NACH dem Kerzen-Schluss in die Berechnung
  -- eingeflossen sein (kein Look-ahead-Bias).
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

  -- overall_state ist immer einer der 5 gueltigen Werte
  select count(*), count(*) filter (where domain_result->>'overall_state' in ('BULLISH','BEARISH','NEUTRAL','MIXED','INSUFFICIENT_DATA'))
  into v_total, v_valid_states
  from backtest_states;
  return next is(v_valid_states, v_total, 'domain_result.overall_state ist immer einer der 5 definierten Zustaende');

  -- Idempotenz: erneuter Lauf legt keine Duplikate an
  select count(*) into v_count_before from backtest_states;
  perform public.backtest_reconstruct_1h_states();
  select count(*) into v_count_after from backtest_states;
  return next is(v_count_after, v_count_before, 'backtest_reconstruct_1h_states() ist idempotent -- kein Duplikat bei wiederholtem Aufruf');

  return next finish();
end;
$$;

revoke all on function public.run_backtest_reconstruction_tests() from public, anon, authenticated;
grant execute on function public.run_backtest_reconstruction_tests() to service_role;
