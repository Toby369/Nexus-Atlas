-- Exportiert aus supabase_migrations.schema_migrations (20260827075719 add_multi_interval_reconstruction_tests)


create or replace function public.run_multi_interval_backtest_tests()
returns setof text
language plpgsql
as $$
declare
  v_1d_count int;
  v_4h_count int;
  v_1d_future_leak int;
  v_1d_second_run int;
  v_interval_mismatch int;
begin
  return next plan(5);

  select count(*) into v_1d_count from backtest_states where interval = '1d' and architecture_version = 'experimental_domain_v2_phase4_full_asof';
  return next cmp_ok(v_1d_count, '>', 200, '1D-Rekonstruktion deckt >200 Tage ab (tiefere Historie fuer mehr Marktregime)');

  select count(*) into v_4h_count from backtest_states where interval = '4h' and architecture_version = 'experimental_domain_v2_phase4_full_asof';
  return next cmp_ok(v_4h_count, '>', 200, '4H-Rekonstruktion deckt >200 Kerzen ab');

  -- Look-ahead-Check fuer funding auf 1D: keine Zeile darf einen
  -- market_snapshots-Wert nach dem 1D-Kerzenschluss verwendet haben.
  select count(*) into v_1d_future_leak
  from backtest_states bs
  where bs.interval = '1d' and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
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
  return next is(v_1d_future_leak, 0, '1D-Rekonstruktion: funding nutzt nachweislich keine Daten nach dem Tages-Kerzenschluss');

  -- Idempotenz auch fuer die generische Funktion (1D, festes Fenster)
  perform public.backtest_reconstruct_states_v2('1d', null, now() - interval '2 days');
  v_1d_second_run := public.backtest_reconstruct_states_v2('1d', null, now() - interval '2 days');
  return next is(v_1d_second_run, 0, 'backtest_reconstruct_states_v2(1d) ist idempotent auf fixem Zeitfenster');

  -- Jede Zeile traegt tatsaechlich das Intervall, mit dem sie erzeugt wurde
  -- (kein Vertauschen von 1h/4h/1d-Kerzen ueber den candle_open_time-Join).
  select count(*) into v_interval_mismatch
  from backtest_states bs
  join market_features mf on mf.symbol='BTCUSDT' and mf.candle_open_time = bs.candle_open_time and mf.interval = bs.interval
  where bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
    and (bs.factors->'structure'->'basis'->>'structure_trend') is distinct from mf.structure_trend;
  return next is(v_interval_mismatch, 0, 'Jede backtest_states-Zeile ist nachweislich aus der market_features-Zeile IHRES EIGENEN Intervalls berechnet');

  return next finish();
end;
$$;

revoke all on function public.run_multi_interval_backtest_tests() from public, anon, authenticated;
grant execute on function public.run_multi_interval_backtest_tests() to service_role;
