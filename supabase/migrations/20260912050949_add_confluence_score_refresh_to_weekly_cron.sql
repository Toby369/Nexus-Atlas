-- Exportiert aus supabase_migrations.schema_migrations (20260912050949 add_confluence_score_refresh_to_weekly_cron)


select cron.unschedule('confluence-score-pipeline-weekly');

select cron.schedule(
  'confluence-score-pipeline-weekly',
  '0 5 * * 1',
  $$
  select research_confluence_extend_chain();
  select research_confluence_extend_activation();
  select research_confluence_refresh_stats();
  select research_confluence_score_refresh();
  $$
);
