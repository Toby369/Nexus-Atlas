-- Exportiert aus supabase_migrations.schema_migrations (20260827031220 fix_dq_test_6_degraded_threshold)

-- Test 6 war falsch kalibriert, nicht die Funktion: bei 50%/50% Fehler-/
-- Luecken-Rate ergibt sich score=75 (Frische 50 + Zuverlaessigkeit 15 +
-- Vollstaendigkeit 10) -- das ist korrekt LIVE, nicht DEGRADED (Schwelle
-- ist score < 60). Testfall auf tatsaechlich score-druenkende Werte
-- korrigiert (100% Fehler- UND Luecken-Rate im Fenster, aber juengster
-- Einzelversuch zufaellig erfolgreich -> Frische 50 + 0 + 0 = 50 < 60).
create or replace function public.run_data_quality_tests()
returns setof text
language plpgsql
as $$
begin
  return query select plan(11);

  return query select results_eq(
    $q$select status from public._dq_evaluate(null, null, 300, 3, 0.0, 0.0, false)$q$,
    array['UNKNOWN'],
    'UNKNOWN wenn last_success_at NULL ist'
  );

  return query select results_eq(
    $q$select quality_score is null from public._dq_evaluate(null, null, 300, 3, 0.0, 0.0, false)$q$,
    array[true],
    'quality_score ist NULL bei UNKNOWN, nicht 0 oder erfunden'
  );

  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.0, 0.0, true)$q$,
    array['ERROR'],
    'ERROR hat Vorrang vor sonst perfektem Score, wenn juengster Versuch fehlschlug'
  );

  return query select results_eq(
    format($q$select status from public._dq_evaluate(now() - interval '2 hours', now() - interval '2 hours', %L, %L, 0.0, 0.0, false)$q$, 300, 3),
    array['STALE'],
    'STALE wenn Alter weit ueber expected_interval * staleness_multiplier liegt'
  );

  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.0, 0.0, false)$q$,
    array['VALIDATED'],
    'VALIDATED bei frischen, fehlerfreien Daten ohne Luecken'
  );

  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 1.0, 1.0, false)$q$,
    array['DEGRADED'],
    'DEGRADED bei score < 60 (100% Fehler-/Luecken-Rate im Fenster, aber juengster Einzelversuch kein Fehler)'
  );

  return query select ok(
    (select quality_score >= 0 and quality_score <= 100
     from public._dq_evaluate(now(), now(), 300, 3, 1.0, 1.0, false)),
    'quality_score bleibt bei Extremwerten innerhalb 0-100'
  );

  return query select cmp_ok(
    (select quality_score from public._dq_evaluate(now() - interval '30 seconds', now() - interval '30 seconds', 300, 3, 0.0, 0.0, false)),
    '=', 100.00::numeric,
    'volle 100 Punkte, wenn Alter klar innerhalb expected_interval liegt'
  );

  return query select ok(
    (select bool_and(status = any(array['LIVE','VALIDATED','DEGRADED','STALE','ERROR','UNKNOWN'])) from public.data_quality),
    'alle data_quality.status-Werte sind gueltige Enum-Werte'
  );

  return query select is(
    (select count(*)::int from public.data_quality),
    (select (select count(*)::int from public.data_quality) from (select public.refresh_data_quality()) x),
    'refresh_data_quality() erzeugt bei wiederholtem Aufruf keine Duplikate (Zeilenanzahl bleibt gleich)'
  );

  return query select is(
    (select count(*)::int from pg_proc where proname = '_dq_evaluate' and pronargs = 7),
    1,
    '_dq_evaluate hat exakt 7 Parameter (Frische/Fehler/Luecken) -- keinerlei Confidence-Bezug in der Signatur'
  );

  return query select * from finish();
end;
$$;
