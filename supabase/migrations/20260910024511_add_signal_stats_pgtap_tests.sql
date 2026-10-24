-- Exportiert aus supabase_migrations.schema_migrations (20260910024511 add_signal_stats_pgtap_tests)


create or replace function public.run_signal_stats_tests()
returns setof text
language plpgsql
as $function$
declare
  b record;
  cnt_before int;
  cnt_after int;
  bad_count int;
  window_count int;
begin
  return next plan(13);

  -- 1) Baseline-Sanity: Richtungswahrscheinlichkeiten liegen in [0,1] und
  --    es gibt genug Paare fuer eine belastbare Baseline (Fenster "all",
  --    Horizont 4h -- die groesste verfuegbare Stichprobe).
  select * into b from public.signal_baseline_stats(4, 'all');
  return next ok(b.baseline_bullish_rate between 0 and 1, 'Baseline bullish-Rate liegt in [0,1]');
  return next ok(b.baseline_bearish_rate between 0 and 1, 'Baseline bearish-Rate liegt in [0,1]');
  return next cmp_ok(b.n_pairs, '>', 1000, 'Baseline (Fenster all, 4h) hat eine grosse Stichprobe (keine Zufallsschwankung durch Kleinstichprobe)');

  -- 2) compute_signal_stats fuellt/aktualisiert signal_stats_results fuer
  --    beide Fenster.
  perform public.compute_signal_stats('90d');
  perform public.compute_signal_stats('all');
  select count(*) into window_count from (select distinct window_label from public.signal_stats_results) w;
  return next is(window_count, 2, 'Beide Fenster (90d und all) sind nach einem Lauf vertreten');

  -- 3) Idempotenz: zweiter Lauf desselben Fensters ohne neue signal_outcomes
  --    dazwischen aendert die Zeilenanzahl nicht (Upsert, kein Duplikat).
  select count(*) into cnt_before from public.signal_stats_results where window_label = '90d';
  perform public.compute_signal_stats('90d');
  select count(*) into cnt_after from public.signal_stats_results where window_label = '90d';
  return next is(cnt_after, cnt_before, 'Wiederholter compute_signal_stats-Lauf ist idempotent (Upsert, keine Duplikate)');

  -- 4) Mindeststichprobe: keine Zelle mit n < 10 hat einen p-Wert/Rang/
  --    Signifikanz-Flag -- "keine Aussage" statt erfundener Sicherheit.
  select count(*) into bad_count
  from public.signal_stats_results
  where n < 10 and (raw_p_value is not null or rank is not null or significant_after_bh is not null);
  return next is(bad_count, 0, 'Zellen mit n<10 bleiben ohne p-Wert/Rang/Signifikanz-Flag');

  -- 5) test_type/Spalten-Konsistenz: directional-Zeilen haben Trefferquote-
  --    Spalten, magnitude-Zeilen haben Magnitude-Spalten -- nie beides oder
  --    keins.
  select count(*) into bad_count
  from public.signal_stats_results
  where test_type = 'directional' and (hit_rate_pct is null or baseline_hit_rate_pct is null);
  return next is(bad_count, 0, 'Jede directional-Zeile hat hit_rate_pct und baseline_hit_rate_pct');

  select count(*) into bad_count
  from public.signal_stats_results
  where test_type = 'magnitude' and (avg_abs_return_pct is null or baseline_avg_abs_return_pct is null);
  return next is(bad_count, 0, 'Jede magnitude-Zeile hat avg_abs_return_pct und baseline_avg_abs_return_pct');

  select count(*) into bad_count
  from public.signal_stats_results
  where (test_type = 'directional') <> (direction_expected is not null);
  return next is(bad_count, 0, 'test_type=directional genau dann, wenn direction_expected gesetzt ist');

  -- 6) BH-FDR-Formel-Konsistenz: bh_critical_value = (rank/m)*0.05, wobei m
  --    die Anzahl der in DEMSELBEN Fenster tatsaechlich getesteten Zellen
  --    (raw_p_value IS NOT NULL) ist.
  select count(*) into bad_count
  from public.signal_stats_results r
  where r.raw_p_value is not null
    and abs(r.bh_critical_value - (
      r.rank::numeric / (select count(*) from public.signal_stats_results r2
                          where r2.window_label = r.window_label and r2.raw_p_value is not null)
    ) * 0.05) > 0.0001;
  return next is(bad_count, 0, 'bh_critical_value entspricht (rank/m)*0.05 innerhalb desselben Fensters');

  -- 7) significant_after_bh stimmt ueberall mit raw_p_value <= bh_critical_value ueberein.
  select count(*) into bad_count
  from public.signal_stats_results
  where raw_p_value is not null and significant_after_bh is distinct from (raw_p_value <= bh_critical_value);
  return next is(bad_count, 0, 'significant_after_bh = (raw_p_value <= bh_critical_value) ueberall');

  -- 8) window_label akzeptiert nur die zwei definierten Werte (Check-Constraint).
  return next is(
    (select count(*)::int from public.signal_stats_results where window_label not in ('90d', 'all')),
    0,
    'window_label ist immer 90d oder all'
  );

  -- 9) compute_signal_stats lehnt ein unbekanntes Fenster ab (kein stiller
  --    Fallback auf ein falsches Fenster).
  return next throws_ok(
    'select public.compute_signal_stats(''bogus'')',
    'p_window muss 90d oder all sein, war: bogus',
    'compute_signal_stats() lehnt ein unbekanntes Fenster explizit ab'
  );

  return next finish();
end;
$function$;

comment on function public.run_signal_stats_tests is
  'pgTAP-Tests fuer den periodischen KI-Rueckblick Phase 2 (10.09.2026): Baseline-Sanity, Idempotenz, Mindeststichprobe-Guard, test_type/Spalten-Konsistenz, BH-FDR-Formel, Fenster-Validierung.';
