-- Exportiert aus supabase_migrations.schema_migrations (20260824194004 add_news_events_title_de)

alter table public.news_events add column if not exists title_de text;
