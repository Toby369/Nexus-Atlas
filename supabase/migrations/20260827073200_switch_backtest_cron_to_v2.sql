-- Exportiert aus supabase_migrations.schema_migrations (20260827073200 switch_backtest_cron_to_v2)


-- Cron auf die neue v2-Rekonstruktion (alle 14 Faktoren, Look-ahead-sicher)
-- umstellen. Die alte v1-Funktion bleibt bestehen (nicht geloescht) --
-- ihre bereits erzeugten 271/273 Zeilen unter architecture_version =
-- 'experimental_domain_v1_phase3' bleiben unveraendert abfragbar, es wird
-- ab jetzt nur nicht mehr automatisch weiter in v1 geschrieben.
select cron.unschedule('backtest-reconstruct-1h-states');

select cron.schedule(
  'backtest-reconstruct-1h-states-v2',
  '*/15 * * * *',
  $$select public.backtest_reconstruct_1h_states_v2();$$
);
