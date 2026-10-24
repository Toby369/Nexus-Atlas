-- Exportiert aus supabase_migrations.schema_migrations (20260827031025 schedule_refresh_data_quality)

select cron.schedule(
  'refresh-data-quality',
  '*/5 * * * *',
  $$select public.refresh_data_quality();$$
);
