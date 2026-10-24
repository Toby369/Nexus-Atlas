-- Exportiert aus supabase_migrations.schema_migrations (20260826090116 schedule_collect_orderbook)

select cron.schedule(
  'collect-orderbook-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-orderbook',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
