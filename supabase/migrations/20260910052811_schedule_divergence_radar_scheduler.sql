-- Exportiert aus supabase_migrations.schema_migrations (20260910052811 schedule_divergence_radar_scheduler)


select cron.schedule(
  'divergence-radar-scheduler-every-15-min',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/divergence-radar-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
