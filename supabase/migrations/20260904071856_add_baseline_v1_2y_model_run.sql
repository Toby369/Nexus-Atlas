-- Exportiert aus supabase_migrations.schema_migrations (20260904071856 add_baseline_v1_2y_model_run)

insert into backtest_model_runs (
  model_version, model_family, description, interval,
  train_start, train_end, validation_start, validation_end, test_start, test_end,
  factor_config, domain_config, weights, trained_on, is_frozen
) values (
  'baseline_v1_2y',
  'baseline',
  'Wie baseline_v1 (identische compute-market-state-Logik v8, 14 Faktoren gleichgewichtet, additive Summe), aber ueber die volle per Backfill erweiterte 2-Jahres-Historie (Binance-Klines seit 2024-09-04) statt nur ~8 Monate. Nicht eingefroren -- Robustheitscheck/Erweiterung von baseline_v1, ersetzt es nicht. Aeltere Teilperioden haben aus Boersen-Restriktionen heraus nur partielle Abdeckung bei positioning/orderbook/options/oi_price/basis (siehe Coverage-Split-Auswertung).',
  '1d',
  '2024-09-04', '2026-01-14',
  '2026-01-15', '2026-05-14',
  '2026-05-15', '2026-09-03',
  '{"factors":["structure","momentum","cvd","oi_price","positioning","orderbook","options","macro","funding","sentiment","trend_strength","trend_regime","vwap_position","basis"],"thresholds":"production_v8_unchanged"}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  'none',
  false
);
