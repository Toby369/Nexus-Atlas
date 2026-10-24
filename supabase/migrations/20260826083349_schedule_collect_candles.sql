-- Exportiert aus supabase_migrations.schema_migrations (20260826083349 schedule_collect_candles)

select cron.schedule(
  'collect-candles-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-candles',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
