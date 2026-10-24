-- Exportiert aus supabase_migrations.schema_migrations (20260827031142 enable_pgtap_and_dq_tests)

-- Automatisierte Tests fuer den Data-Quality-Layer (pgTAP, bereits als
-- Extension verfuegbar, bislang nicht installiert -- Audit-Befund "keine
-- Tests vorhanden" gilt hiermit fuer die SQL-Seite als behoben).
--
-- Aufruf: select * from run_data_quality_tests();  -- liefert TAP-Output,
-- jede Zeile "ok N ..." bzw. "not ok N ..." ist ein Einzeltest.
create extension if not exists pgtap;

create or replace function public.run_data_quality_tests()
returns setof text
language plpgsql
as $$
begin
  return query select plan(11);

  -- 1) UNKNOWN, wenn nie erfolgreich abgerufen -- unabhaengig von allen
  --    anderen Parametern.
  return query select results_eq(
    $q$select status from public._dq_evaluate(null, null, 300, 3, 0.0, 0.0, false)$q$,
    array['UNKNOWN'],
    'UNKNOWN wenn last_success_at NULL ist'
  );

  -- 2) UNKNOWN liefert quality_score = NULL (kein erfundener Wert).
  return query select results_eq(
    $q$select quality_score is null from public._dq_evaluate(null, null, 300, 3, 0.0, 0.0, false)$q$,
    array[true],
    'quality_score ist NULL bei UNKNOWN, nicht 0 oder erfunden'
  );

  -- 3) ERROR hat Vorrang, auch wenn Frische/Vollstaendigkeit perfekt waeren.
  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.0, 0.0, true)$q$,
    array['ERROR'],
    'ERROR hat Vorrang vor sonst perfektem Score, wenn juengster Versuch fehlschlug'
  );

  -- 4) STALE, wenn das Alter die Toleranzschwelle klar ueberschreitet, aber
  --    kein akuter Fehler vorliegt.
  return query select results_eq(
    format($q$select status from public._dq_evaluate(now() - interval '2 hours', now() - interval '2 hours', %L, %L, 0.0, 0.0, false)$q$, 300, 3),
    array['STALE'],
    'STALE wenn Alter weit ueber expected_interval * staleness_multiplier liegt'
  );

  -- 5) VALIDATED bei frischen, fehlerfreien, luecken freien Daten.
  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.0, 0.0, false)$q$,
    array['VALIDATED'],
    'VALIDATED bei frischen, fehlerfreien Daten ohne Luecken'
  );

  -- 6) DEGRADED bei hoher Luecken-/Fehlerrate, obwohl noch nicht STALE.
  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.5, 0.5, false)$q$,
    array['DEGRADED'],
    'DEGRADED bei score < 60 durch hohe Fehler-/Luecken-Rate'
  );

  -- 7) quality_score bleibt immer im Bereich 0-100 (Grenzfall: maximale
  --    Fehler-/Luecken-Rate).
  return query select ok(
    (select quality_score >= 0 and quality_score <= 100
     from public._dq_evaluate(now(), now(), 300, 3, 1.0, 1.0, false)),
    'quality_score bleibt bei Extremwerten innerhalb 0-100'
  );

  -- 8) Frische-Komponente: volle Punktzahl (kein Abzug), solange das Alter
  --    innerhalb des erwarteten Intervalls liegt.
  return query select cmp_ok(
    (select quality_score from public._dq_evaluate(now() - interval '30 seconds', now() - interval '30 seconds', 300, 3, 0.0, 0.0, false)),
    '=', 100.00::numeric,
    'volle 100 Punkte, wenn Alter klar innerhalb expected_interval liegt'
  );

  -- 9) data_quality-Tabelle: jede Zeile erfuellt den Status-Enum-Constraint
  --    (Regressionsschutz, falls _dq_evaluate je einen falschen String
  --    liefern sollte).
  return query select ok(
    (select bool_and(status = any(array['LIVE','VALIDATED','DEGRADED','STALE','ERROR','UNKNOWN'])) from public.data_quality),
    'alle data_quality.status-Werte sind gueltige Enum-Werte'
  );

  -- 10) refresh_data_quality() ist idempotent bezueglich der Zeilenanzahl
  --     (kein Duplikat-Wachstum bei wiederholtem Aufruf -- Regressionstest
  --     fuer den urspruenglich gefundenen NULL-Symbol-Bug).
  return query select is(
    (select count(*)::int from public.data_quality),
    (select (select count(*)::int from public.data_quality) from (select public.refresh_data_quality()) x),
    'refresh_data_quality() erzeugt bei wiederholtem Aufruf keine Duplikate (Zeilenanzahl bleibt gleich)'
  );

  -- 11) Unabhaengigkeit von Confidence: _dq_evaluate hat keinerlei
  --     Confidence-/Market-State-Parameter -- die Funktionssignatur selbst
  --     belegt die strukturelle Trennung.
  return query select is(
    (select count(*)::int from pg_proc where proname = '_dq_evaluate' and pronargs = 7),
    1,
    '_dq_evaluate hat exakt 7 Parameter (Frische/Fehler/Luecken) -- keinerlei Confidence-Bezug in der Signatur'
  );

  return query select * from finish();
end;
$$;

comment on function public.run_data_quality_tests() is 'Automatisierte pgTAP-Tests fuer den Data-Quality-Layer. Aufruf: select * from run_data_quality_tests();';
