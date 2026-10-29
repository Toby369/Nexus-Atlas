-- Exportiert aus supabase_migrations.schema_migrations (20260904041825 add_send_state_change_push_cron)

select cron.schedule(
  'send-state-change-push-every-15-min',
  '3-59/15 * * * *',
  $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/send-state-change-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
