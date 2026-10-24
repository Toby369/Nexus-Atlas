-- Stand aller pg_cron-Jobs (cron.job)

-- collect-btc-every-5-min (aktiv: True)
select cron.schedule('collect-btc-every-5-min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-btc',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $cron$);

-- collect-candles-every-15-min (aktiv: True)
select cron.schedule('collect-candles-every-15-min', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-candles',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$);

-- collect-economic-calendar-daily (aktiv: True)
select cron.schedule('collect-economic-calendar-daily', '0 7 * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-economic-calendar',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);

-- collect-etf-flows (aktiv: True)
select cron.schedule('collect-etf-flows', '0 */4 * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-etf-flows',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);

-- collect-liquidations (aktiv: True)
select cron.schedule('collect-liquidations', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-liquidations',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 40000
  );
  $cron$);

-- collect-macro-every-30-min (aktiv: True)
select cron.schedule('collect-macro-every-30-min', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-macro',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 45000
  );
  $cron$);

-- collect-onchain-daily (aktiv: True)
select cron.schedule('collect-onchain-daily', '0 6 * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-onchain',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);

-- collect-options-every-30-min (aktiv: True)
select cron.schedule('collect-options-every-30-min', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-options',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 45000
  );
  $cron$);

-- collect-orderbook-every-5-min (aktiv: True)
select cron.schedule('collect-orderbook-every-5-min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-orderbook',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);

-- collect-positioning-every-5-min (aktiv: True)
select cron.schedule('collect-positioning-every-5-min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-positioning',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $cron$);

-- collect-sentiment-hourly (aktiv: True)
select cron.schedule('collect-sentiment-hourly', '0 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-sentiment',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );
  $cron$);

-- collect-spot-pressure-every-5-min (aktiv: True)
select cron.schedule('collect-spot-pressure-every-5-min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-spot-pressure',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cron$);

-- collect-spot-volume-profile-every-5-min (aktiv: True)
select cron.schedule('collect-spot-volume-profile-every-5-min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-spot-volume-profile',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 40000
  );
  $cron$);

-- collect-term-basis-hourly (aktiv: True)
select cron.schedule('collect-term-basis-hourly', '11 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-term-basis',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 45000
  );
$cron$);

-- compute-market-state-every-15-min (aktiv: True)
select cron.schedule('compute-market-state-every-15-min', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/compute-market-state',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);

-- confluence-score-pipeline-weekly (aktiv: True)
select cron.schedule('confluence-score-pipeline-weekly', '0 5 * * 1', $cron$
  select research_confluence_extend_chain();
  select research_confluence_extend_activation();
  select research_confluence_refresh_stats();
  select research_confluence_score_refresh();
  $cron$);

-- detect-signal-outcomes-every-15-min (aktiv: True)
select cron.schedule('detect-signal-outcomes-every-15-min', '*/15 * * * *', $cron$
    select public.detect_tradingview_signal_outcomes();
    select public.detect_warning_pattern_outcomes();
    select public.detect_risk_factor_outcomes();
    select public.detect_overall_state_outcomes();
    select public.detect_regime_matrix_outcomes();
    select public.detect_spot_pressure_absorption_outcomes();
    select public.detect_onchain_vs_price_outcomes();
    select public.detect_rsi_divergence_vs_trend_outcomes();
    select public.detect_spot_pressure_vs_orderbook_outcomes();
  $cron$);

-- divergence-radar-scheduler-every-15-min (aktiv: True)
select cron.schedule('divergence-radar-scheduler-every-15-min', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/divergence-radar-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);

-- downsample-old-snapshots-daily (aktiv: True)
select cron.schedule('downsample-old-snapshots-daily', '41 3 * * *', $cron$select public.downsample_old_snapshots();$cron$);

-- fill-signal-outcomes-every-15-min (aktiv: True)
select cron.schedule('fill-signal-outcomes-every-15-min', '5-59/15 * * * *', $cron$select public.fill_signal_outcomes();$cron$);

-- nexus-news-analyst-every-15-min (aktiv: True)
select cron.schedule('nexus-news-analyst-every-15-min', '2-59/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/nexus-news-analyst',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$);

-- nexus-news-collector-every-15-min (aktiv: True)
select cron.schedule('nexus-news-collector-every-15-min', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/nexus-news-collector',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$);

-- purge-cron-history-daily (aktiv: True)
select cron.schedule('purge-cron-history-daily', '17 3 * * *', $cron$delete from cron.job_run_details where end_time < now() - interval '7 days'$cron$);

-- purge-old-1m-candles-daily (aktiv: True)
select cron.schedule('purge-old-1m-candles-daily', '23 3 * * *', $cron$delete from public.candles where interval = '1m' and open_time < now() - interval '14 days'$cron$);

-- refresh-data-quality (aktiv: True)
select cron.schedule('refresh-data-quality', '7 * * * *', $cron$select public.refresh_data_quality();$cron$);

-- refresh-market-state-matrix-every-15-min (aktiv: True)
select cron.schedule('refresh-market-state-matrix-every-15-min', '*/15 * * * *', $cron$select public.refresh_market_state_matrix();$cron$);

-- regime-score-pipeline-weekly (aktiv: True)
select cron.schedule('regime-score-pipeline-weekly', '30 5 * * 1', $cron$select research_regime_extend_activation(); select research_regime_refresh_funding_history(); select research_regime_extend_activation_round2(); select research_regime_extend_activation_round3(); select research_regime_extend_activation_round4(); select research_regime_extend_activation_round5(); select research_regime_refresh_cci_roc_1h(); select research_regime_extend_activation_round6(); select research_regime_extend_activation_round7(); select research_regime_refresh_stats(); select research_regime_score_refresh();$cron$);

-- report-scheduler-every-5-min (aktiv: True)
select cron.schedule('report-scheduler-every-5-min', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/report-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$);

-- send-state-change-push-every-15-min (aktiv: True)
select cron.schedule('send-state-change-push-every-15-min', '3-59/15 * * * *', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/send-state-change-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);

-- signal-review-scheduler-weekly (aktiv: True)
select cron.schedule('signal-review-scheduler-weekly', '15 5 * * 1', $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/signal-review-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$);

-- weekly-signal-stats (aktiv: True)
select cron.schedule('weekly-signal-stats', '0 5 * * 1', $cron$select public.run_weekly_signal_stats();$cron$);

