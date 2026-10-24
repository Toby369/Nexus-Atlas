-- Exportiert aus supabase_migrations.schema_migrations (20260908185328 fix_youtube_monitor_scheduler_timeout)

select cron.unschedule('youtube-monitor-scheduler-daily');

select cron.schedule(
  'youtube-monitor-scheduler-daily',
  '30 6 * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/youtube-monitor-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 240000
  );
  $$
);
