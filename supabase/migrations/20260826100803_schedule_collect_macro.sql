-- Exportiert aus supabase_migrations.schema_migrations (20260826100803 schedule_collect_macro)

select cron.schedule(
  'collect-macro-every-30-min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-macro',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 45000
  );
  $$
);
