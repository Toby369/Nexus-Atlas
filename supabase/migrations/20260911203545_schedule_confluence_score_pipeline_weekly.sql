-- Exportiert aus supabase_migrations.schema_migrations (20260911203545 schedule_confluence_score_pipeline_weekly)


select cron.schedule(
  'confluence-score-pipeline-weekly',
  '0 5 * * 1',
  $$
  select research_confluence_extend_chain();
  select research_confluence_extend_activation();
  select research_confluence_refresh_stats();
  $$
);
