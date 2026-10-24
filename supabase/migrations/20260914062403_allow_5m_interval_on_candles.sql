-- Exportiert aus supabase_migrations.schema_migrations (20260914062403 allow_5m_interval_on_candles)

alter table candles drop constraint candles_interval_check;
alter table candles add constraint candles_interval_check check (interval = any (array['1m','5m','15m','1h','4h','1d']));
