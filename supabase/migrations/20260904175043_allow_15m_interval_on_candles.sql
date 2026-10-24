-- Exportiert aus supabase_migrations.schema_migrations (20260904175043 allow_15m_interval_on_candles)


alter table public.candles drop constraint candles_interval_check;
alter table public.candles add constraint candles_interval_check check (interval = any (array['15m','1h','4h','1d']));
