-- Exportiert aus supabase_migrations.schema_migrations (20260910030546 schedule_signal_review_scheduler)


-- Periodischer KI-Rueckblick Phase 3: 15 Min nach dem woechentlichen
-- compute_signal_stats()-Cron (Montag 05:00 UTC), damit
-- signal_stats_results garantiert frisch ist, bevor signal-review-scheduler
-- die KI-Einordnung anstoesst.
select cron.schedule(
  'signal-review-scheduler-weekly',
  '15 5 * * 1',
  $cron$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/signal-review-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
