-- Exportiert aus supabase_migrations.schema_migrations (20260930195304 add_spot_volume_profile)

-- Spot Volume Profile (30.09.2026, Nutzer-Idee): wo genau wurde Spot-BTC
-- gekauft/verkauft -- im Unterschied zu Spot-Pressure (EINE Zahl je
-- Zeitfenster, keine Preis-Information) hier je Preis-Stufe aggregiert, um
-- Kauf-/Verkaufs-Konzentrationen (Support-/Widerstands-Hinweis) sichtbar zu
-- machen. Bewusst NICHT jeder Einzel-Trade gespeichert (unbegrenztes
-- Wachstum), sondern bereits beim Einsammeln pro Lauf in $100-Preis-Buckets
-- vorverdichtet -- gleiches Prinzip wie liquidation_events ->
-- get_liquidation_intelligence(), nur fuer Binance-Spot-aggTrades statt
-- Liquidations-Events.

create table public.spot_volume_buckets (
  id bigint generated always as identity primary key,
  bucket_time_utc timestamptz not null default now(),
  exchange text not null default 'binance',
  symbol text not null default 'BTCUSDT',
  price_bucket numeric not null,
  buy_volume numeric not null default 0,
  sell_volume numeric not null default 0,
  trade_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_spot_volume_buckets_time on public.spot_volume_buckets (bucket_time_utc);
create index idx_spot_volume_buckets_lookup on public.spot_volume_buckets (exchange, symbol, price_bucket);

alter table public.spot_volume_buckets enable row level security;
create policy "Public read access" on public.spot_volume_buckets for select using (true);

-- Cursor (letzte verarbeitete Binance aggTradeId) statt ueberlappender
-- Zeitfenster -- verhindert luecken-/dublettenfreies Double-Counting beim
-- Aggregieren (waere bei einem reinen "letzte 5 Minuten"-Fenster nicht
-- garantiert, Cron-Jitter wuerde Trades doppelt oder gar nicht erfassen).
create table public.spot_volume_profile_cursor (
  exchange text not null,
  symbol text not null,
  last_agg_trade_id bigint,
  updated_at timestamptz not null default now(),
  primary key (exchange, symbol)
);

alter table public.spot_volume_profile_cursor enable row level security;
create policy "Public read access" on public.spot_volume_profile_cursor for select using (true);

-- Analog zu get_liquidation_intelligence(): fasst die vorverdichteten
-- $100-Buckets ueber ein Zeitfenster zu den vom Aufrufer gewuenschten,
-- groeberen Preis-Buckets zusammen (Default 200, wie bei Liquidations-
-- Clustern).
create or replace function public.get_spot_volume_profile(p_since timestamptz, p_price_bucket_usd numeric default 200)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with buckets as (
    select
      round(price_bucket / p_price_bucket_usd) * p_price_bucket_usd as price_bucket,
      sum(buy_volume) as buy_volume,
      sum(sell_volume) as sell_volume,
      sum(trade_count) as trade_count
    from spot_volume_buckets
    where bucket_time_utc >= p_since
      and exchange = 'binance' and symbol = 'BTCUSDT'
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'price_buckets', coalesce((select jsonb_agg(row_to_json(buckets)) from buckets), '[]'::jsonb),
    'total_buy_volume', coalesce((select sum(buy_volume) from buckets), 0),
    'total_sell_volume', coalesce((select sum(sell_volume) from buckets), 0)
  );
$$;
