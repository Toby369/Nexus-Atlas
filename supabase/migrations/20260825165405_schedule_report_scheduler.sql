-- Exportiert aus supabase_migrations.schema_migrations (20260825165405 schedule_report_scheduler)

select cron.schedule(
  'report-scheduler-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/report-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
