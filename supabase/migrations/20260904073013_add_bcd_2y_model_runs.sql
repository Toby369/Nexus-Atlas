-- Exportiert aus supabase_migrations.schema_migrations (20260904073013 add_bcd_2y_model_runs)

insert into backtest_model_runs (
  model_version, model_family, description, interval,
  train_start, train_end, validation_start, validation_end, test_start, test_end,
  factor_config, domain_config, weights, trained_on, is_frozen
)
select
  m.model_version || '_2y', m.model_family,
  m.description || ' -- Erweiterung auf die per Backfill verfuegbare 2-Jahres-Historie (2024-09-04 bis heute), identischer Split wie baseline_v1_2y. Nicht eingefroren.',
  '1d',
  '2024-09-04', '2026-01-14',
  '2026-01-15', '2026-05-14',
  '2026-05-15', '2026-09-03',
  m.factor_config, m.domain_config, m.weights, m.trained_on, false
from backtest_model_runs m
where m.model_version in ('domain_balanced_v1', 'calibrated_v1', 'redundancy_aware_v1');
