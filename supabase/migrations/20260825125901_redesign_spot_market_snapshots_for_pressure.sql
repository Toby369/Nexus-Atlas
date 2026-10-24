-- Exportiert aus supabase_migrations.schema_migrations (20260825125901 redesign_spot_market_snapshots_for_pressure)

-- spot_market_snapshots war bisher ungenutzt (0 echte Zeilen, nur 1 Test-
-- Zeile vom 19.08. mit stale Preis $64k, keine Frontend-Referenz) und hatte
-- zwei redundante 24h-Volumen-Spaltenpaare (volume_24h/spot_volume_24h,
-- quote_volume_24h/spot_quote_volume_24h) ohne den fuer Buying/Selling
-- Pressure eigentlich benoetigten Taker-Buy/Sell-Split. Da die Tabelle nie
-- produktiv befuellt wurde, wird sie sauber fuer den tatsaechlichen Zweck
-- umgebaut statt weitere Alias-Spalten anzuhaeufen.
truncate table public.spot_market_snapshots;

alter table public.spot_market_snapshots
  drop column volume_24h,
  drop column quote_volume_24h,
  drop column spot_volume_24h,
  drop column spot_quote_volume_24h;

alter table public.spot_market_snapshots
  add column interval_minutes integer not null default 5,
  add column open_price numeric,
  add column base_volume numeric,
  add column quote_volume numeric,
  add column taker_buy_vol numeric,
  add column taker_sell_vol numeric,
  add column taker_buy_quote_vol numeric,
  add column taker_sell_quote_vol numeric,
  add column taker_buy_sell_ratio numeric,
  add column trade_count integer;

comment on table public.spot_market_snapshots is
  'Binance Spot BTCUSDT, ein Datenpunkt pro abgeschlossener 5m-Kerze. taker_buy_vol/taker_sell_vol kommen direkt aus der Binance-Kline (taker_sell_vol = base_volume - taker_buy_vol, exakt, keine Schaetzung). Bewusst nur Binance: einzige oeffentliche Spot-Route mit Taker-Buy/Sell-Split je Kerze (Bybit/OKX-Spot-Klines liefern das nicht).';

alter table public.spot_market_snapshots enable row level security;
drop policy if exists "Public read access" on public.spot_market_snapshots;
create policy "Public read access" on public.spot_market_snapshots
  for select using (true);
