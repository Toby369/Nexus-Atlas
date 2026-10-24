-- Exportiert aus supabase_migrations.schema_migrations (20260904175054 allow_15m_interval_on_market_features)


alter table public.market_features drop constraint market_features_interval_check;
alter table public.market_features add constraint market_features_interval_check check (interval = any (array['15m','1h','4h','1d']));
