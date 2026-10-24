-- Exportiert aus supabase_migrations.schema_migrations (20260905165447 schedule_collect_btc_price_history_daily)

select cron.schedule(
  'collect-btc-price-history-daily',
  '15 6 * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-btc-price-history-daily',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
