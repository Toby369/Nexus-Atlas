-- Exportiert aus supabase_migrations.schema_migrations (20260826110132 schedule_compute_market_state)

select cron.schedule(
  'compute-market-state-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/compute-market-state',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
