-- Exportiert aus supabase_migrations.schema_migrations (20260827073555 add_multi_version_regression_test_to_hit_rate)


-- Regressionstest fuer den gerade gefundenen Doppelzaehl-Bug: n muss <=
-- Anzahl der v2-Zeilen sein, die ueberhaupt eine Forward-Beobachtung im
-- Fenster haben koennen -- niemals mehr, wie es bei einem versehentlichen
-- Join ueber mehrere architecture_version-Werte hinweg der Fall waere.
create or replace function public.run_backtest_hit_rate_tests()
returns setof text
language plpgsql
as $$
declare
  v_null_baseline_for_directional int;
  v_arith_mismatch int;
  v_n_not_shrinking int;
  v_n_1h_bullish int;
  v_v2_bullish_count int;
begin
  return next plan(4);

  select count(*) into v_null_baseline_for_directional
  from backtest_hit_rate_by_horizon()
  where overall_state in ('BULLISH','BEARISH') and baseline_hit_rate_pct is null;
  return next is(v_null_baseline_for_directional, 0, 'BULLISH/BEARISH haben immer eine Baseline-Hit-Rate zum Vergleich');

  select count(*) into v_arith_mismatch
  from backtest_hit_rate_by_horizon()
  where overall_state in ('BULLISH','BEARISH')
    and round(hit_rate_pct - baseline_hit_rate_pct, 1) <> edge_vs_baseline_pp;
  return next is(v_arith_mismatch, 0, 'edge_vs_baseline_pp = hit_rate_pct - baseline_hit_rate_pct (keine verdeckte Rundung/Fehlrechnung)');

  select count(*) into v_n_not_shrinking
  from (
    select overall_state, horizon_hours, n,
      lag(n) over (partition by overall_state order by horizon_hours) as prev_n
    from backtest_hit_rate_by_horizon()
  ) x
  where prev_n is not null and n > prev_n;
  return next is(v_n_not_shrinking, 0, 'n sinkt monoton mit wachsendem Horizont (Randbeschraenkung durch fehlende Zukunftsdaten korrekt beruecksichtigt)');

  -- Kein Doppelzaehlen ueber mehrere architecture_version hinweg: n (1h,
  -- BULLISH) darf nicht groesser sein als die Anzahl v2-BULLISH-Zeilen
  -- ueberhaupt -- waere es groesser, wuerden v1 und v2 faelschlich addiert.
  select n into v_n_1h_bullish from backtest_hit_rate_by_horizon(array[1]) where overall_state = 'BULLISH';
  select count(*) into v_v2_bullish_count
  from backtest_states
  where architecture_version = 'experimental_domain_v2_phase4_full_asof' and domain_result->>'overall_state' = 'BULLISH';
  return next cmp_ok(v_n_1h_bullish, '<=', v_v2_bullish_count, 'Hit-Rate zaehlt keine Zeile doppelt ueber mehrere architecture_version hinweg');

  return next finish();
end;
$$;
