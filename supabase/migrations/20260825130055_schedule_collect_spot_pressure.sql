-- Exportiert aus supabase_migrations.schema_migrations (20260825130055 schedule_collect_spot_pressure)

select cron.schedule(
  'collect-spot-pressure-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-spot-pressure',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
