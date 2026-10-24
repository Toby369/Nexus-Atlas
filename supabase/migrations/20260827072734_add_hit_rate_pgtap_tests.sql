-- Exportiert aus supabase_migrations.schema_migrations (20260827072734 add_hit_rate_pgtap_tests)


create or replace function public.run_backtest_hit_rate_tests()
returns setof text
language plpgsql
as $$
declare
  v_null_baseline_for_directional int;
  v_arith_mismatch int;
  v_n_not_shrinking int;
begin
  return next plan(3);

  -- BULLISH/BEARISH muessen immer eine Baseline haben (MIXED/NEUTRAL nie,
  -- da sie keine gerichtete Erwartung haben -- siehe Funktionskommentar).
  select count(*) into v_null_baseline_for_directional
  from backtest_hit_rate_by_horizon()
  where overall_state in ('BULLISH','BEARISH') and baseline_hit_rate_pct is null;
  return next is(v_null_baseline_for_directional, 0, 'BULLISH/BEARISH haben immer eine Baseline-Hit-Rate zum Vergleich');

  -- edge_vs_baseline_pp muss rechnerisch exakt hit_rate_pct - baseline_hit_rate_pct sein
  select count(*) into v_arith_mismatch
  from backtest_hit_rate_by_horizon()
  where overall_state in ('BULLISH','BEARISH')
    and round(hit_rate_pct - baseline_hit_rate_pct, 1) <> edge_vs_baseline_pp;
  return next is(v_arith_mismatch, 0, 'edge_vs_baseline_pp = hit_rate_pct - baseline_hit_rate_pct (keine verdeckte Rundung/Fehlrechnung)');

  -- n darf mit wachsendem Horizont nicht steigen (Randbeschraenkung: je
  -- laenger der Horizont, desto weniger Zeilen haben ueberhaupt eine
  -- Preis-Beobachtung so weit in der Zukunft).
  select count(*) into v_n_not_shrinking
  from (
    select overall_state, horizon_hours, n,
      lag(n) over (partition by overall_state order by horizon_hours) as prev_n
    from backtest_hit_rate_by_horizon()
  ) x
  where prev_n is not null and n > prev_n;
  return next is(v_n_not_shrinking, 0, 'n sinkt monoton mit wachsendem Horizont (Randbeschraenkung durch fehlende Zukunftsdaten korrekt beruecksichtigt)');

  return next finish();
end;
$$;

revoke all on function public.run_backtest_hit_rate_tests() from public, anon, authenticated;
grant execute on function public.run_backtest_hit_rate_tests() to service_role;
