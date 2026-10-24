-- Exportiert aus supabase_migrations.schema_migrations (20260826085818 create_orderbook_snapshots)

create table public.orderbook_snapshots (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  exchange text not null,
  symbol text not null default 'BTCUSDT',
  best_bid numeric,
  best_ask numeric,
  mid_price numeric,
  spread_abs numeric,
  spread_pct numeric,
  bid_depth_usd numeric,
  ask_depth_usd numeric,
  depth_imbalance numeric,
  bid_wall_price numeric,
  bid_wall_usd numeric,
  ask_wall_price numeric,
  ask_wall_usd numeric,
  status text not null default 'ok' check (status in ('ok','error')),
  error text,
  created_at timestamptz not null default now()
);

create index idx_orderbook_snapshots_lookup on public.orderbook_snapshots (exchange, symbol, timestamp_utc desc);

alter table public.orderbook_snapshots enable row level security;
create policy "Public read access" on public.orderbook_snapshots for select using (true);

comment on table public.orderbook_snapshots is 'Orderbook-Tiefe je Boerse (Binance/Bybit/OKX Futures), ein Datenpunkt alle 5 Min. bid/ask_depth_usd = summierte USD-Groesse innerhalb ORDERBOOK_DEPTH_RANGE_PCT um den Mid-Preis (siehe collect-orderbook). depth_imbalance = (bid-ask)/(bid+ask), -1..1, positiv = mehr Kauf- als Verkaufstiefe. *_wall_* = groesstes Einzel-Level innerhalb der erfassten Tiefe, sofern deutlich (WALL_MULTIPLIER) ueber dem Median der erfassten Level liegt, sonst NULL.';
comment on column public.orderbook_snapshots.depth_imbalance is '(bid_depth_usd - ask_depth_usd) / (bid_depth_usd + ask_depth_usd). Rohmaterial, kein eigenstaendiges Handelssignal.';
