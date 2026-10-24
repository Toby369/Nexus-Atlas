-- Exportiert aus supabase_migrations.schema_migrations (20260904074502 add_funding_only_model_run)

insert into backtest_model_runs (
  model_version, model_family, description, interval,
  train_start, train_end, validation_start, validation_end, test_start, test_end,
  factor_config, domain_config, weights, trained_on, is_frozen
) values (
  'funding_only_v1_2y',
  'benchmark_funding_only',
  'Benchmark: nur der funding-Faktor als Signal (Binance Funding Rate, diskretisiert wie in compute-market-state -- >0.0005 BEARISH, <-0.0005 BULLISH, sonst NEUTRAL). Kein anderer Faktor einbezogen. War in PHASE-0-RECONCILIATION.md Abschnitt 12 als "spezifiziert, nicht gebaut / NOT TESTABLE WITH CURRENT DATA" markiert -- jetzt mit 2 Jahren Funding-Historie testbar. Gleicher Split wie baseline_v1_2y fuer direkten Vergleich.',
  '1d',
  '2024-09-04', '2026-01-14',
  '2026-01-15', '2026-05-14',
  '2026-05-15', '2026-09-03',
  '{"factors":["funding"],"thresholds":"production_v8_unchanged"}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  'none',
  false
);
