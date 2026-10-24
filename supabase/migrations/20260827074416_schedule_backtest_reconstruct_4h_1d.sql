-- Exportiert aus supabase_migrations.schema_migrations (20260827074416 schedule_backtest_reconstruct_4h_1d)


-- 4H-Kerzen schliessen alle 4 Stunden -- stuendlicher Takt reicht, um eine
-- neue Kerze spaetestens 1h nach Verfuegbarkeit nachzuziehen (idempotent,
-- ON CONFLICT DO NOTHING macht haeufigeres Pruefen unschaedlich, aber
-- unnoetig).
select cron.schedule(
  'backtest-reconstruct-4h-states-v2',
  '0 * * * *',
  $$select public.backtest_reconstruct_states_v2('4h');$$
);

-- 1D-Kerzen schliessen einmal taeglich -- taeglicher Takt, leicht versetzt
-- zu collect-onchain-daily (06:00 UTC), um keine Ressourcenkonkurrenz zu
-- provozieren.
select cron.schedule(
  'backtest-reconstruct-1d-states-v2',
  '20 6 * * *',
  $$select public.backtest_reconstruct_states_v2('1d');$$
);
