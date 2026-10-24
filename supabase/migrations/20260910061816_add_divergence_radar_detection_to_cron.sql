-- Exportiert aus supabase_migrations.schema_migrations (20260910061816 add_divergence_radar_detection_to_cron)


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
    select public.detect_spot_pressure_absorption_outcomes();
    select public.detect_onchain_vs_price_outcomes();
    select public.detect_rsi_divergence_vs_trend_outcomes();
  $cron$
);
