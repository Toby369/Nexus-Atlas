-- Exportiert aus supabase_migrations.schema_migrations (20260825130005 spot_market_snapshots_unique_candle)

-- Verhindert Duplikatzeilen, falls derselbe abgeschlossene 5m-Kerzen-
-- Zeitstempel durch einen verspaeteten/wiederholten Cron-Tick erneut
-- abgefragt wird (analog zum bestehenden Muster bei liquidation_events).
create unique index if not exists spot_market_snapshots_unique_candle
  on public.spot_market_snapshots (exchange, symbol, timestamp_utc);
