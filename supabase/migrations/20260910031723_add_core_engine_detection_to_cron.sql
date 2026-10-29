-- Exportiert aus supabase_migrations.schema_migrations (20260910031723 add_core_engine_detection_to_cron)


-- Nimmt die beiden neuen Phase-4-Detection-Funktionen in den bestehenden
-- 15-Min-Cron auf (bereits per execute_sql live aktiviert, hier zur
-- Nachvollziehbarkeit als Migration nachgezogen -- unschedule+reschedule
-- ist idempotent, kein Doppel-Cron-Risiko).
select cron.unschedule('detect-signal-outcomes-every-15-min');
select cron.schedule(
  'detect-signal-outcomes-every-15-min',
  '*/15 * * * *',
  $cron$
    select public.detect_tradingview_signal_outcomes();
    select public.detect_warning_pattern_outcomes();
    select public.detect_risk_factor_outcomes();
    select public.detect_overall_state_outcomes();
    select public.detect_regime_matrix_outcomes();
  $cron$
);
