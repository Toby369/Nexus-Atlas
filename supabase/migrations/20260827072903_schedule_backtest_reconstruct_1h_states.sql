-- Exportiert aus supabase_migrations.schema_migrations (20260827072903 schedule_backtest_reconstruct_1h_states)


-- Laufende Rekonstruktion: haengt kontinuierlich neue 1H-market_features-
-- Zeilen an backtest_states an, sobald sie eintreffen. Gleiches Muster wie
-- refresh-data-quality (direkter SQL-Aufruf ueber pg_cron, keine Edge
-- Function noetig). idempotent durch ON CONFLICT DO NOTHING in der
-- Funktion selbst -- ein Ueberlappen zweier Laeufe ist unschaedlich.
-- 15-Minuten-Takt, weil compute-market-state auf demselben Rhythmus neue
-- 1H-Kerzen erkennt; die eigentliche Kerze aendert sich nur stuendlich,
-- der haeufigere Takt sorgt lediglich dafuer, dass eine neue Stunde
-- spaetestens 15 Min. nach Verfuegbarkeit nachgezogen wird.
select cron.schedule(
  'backtest-reconstruct-1h-states',
  '*/15 * * * *',
  $$select public.backtest_reconstruct_1h_states();$$
);
