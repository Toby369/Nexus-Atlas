-- Exportiert aus supabase_migrations.schema_migrations (20260818193911 add_spot_volume_alias_columns)

alter table public.spot_market_snapshots add column if not exists spot_volume_24h numeric;
alter table public.spot_market_snapshots add column if not exists spot_quote_volume_24h numeric;
