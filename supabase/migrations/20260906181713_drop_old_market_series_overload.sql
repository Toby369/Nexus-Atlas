-- Exportiert aus supabase_migrations.schema_migrations (20260906181713 drop_old_market_series_overload)

drop function if exists public.get_market_series(text, timestamptz, integer);
