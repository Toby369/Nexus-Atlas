-- Exportiert aus supabase_migrations.schema_migrations (20260826085208 add_range_high_low_to_market_features)

alter table public.market_features
  add column range_high_20 numeric,
  add column range_low_20 numeric;

comment on column public.market_features.range_high_20 is 'Hoechster High der letzten 20 Kerzen (inkl. dieser) -- Donchian-Channel-Standardperiode, konfigurierbar in collect-candles (RANGE_LOOKBACK).';
comment on column public.market_features.range_low_20 is 'Tiefster Low der letzten 20 Kerzen (inkl. dieser).';
