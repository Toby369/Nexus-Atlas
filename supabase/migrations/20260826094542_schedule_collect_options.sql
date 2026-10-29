-- Exportiert aus supabase_migrations.schema_migrations (20260826094542 schedule_collect_options)

select cron.schedule(
  'collect-options-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-options',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 45000
  );
  $$
);
