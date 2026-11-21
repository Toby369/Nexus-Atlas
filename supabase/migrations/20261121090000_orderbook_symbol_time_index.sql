-- Dashboard (21.11.2026): divergenceRadarContext liest die letzten 30
-- Orderbuch-Snapshots ueber alle Boersen (nur symbol, sortiert nach Zeit).
-- Der bestehende Index beginnt mit exchange und passt nicht -> Seq Scan,
-- 0,66 s, bei Last Zeitueberschreitung. Index ca. 2 MB.
create index if not exists idx_orderbook_snapshots_symbol_time
  on public.orderbook_snapshots (symbol, timestamp_utc desc);
