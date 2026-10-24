-- Exportiert aus supabase_migrations.schema_migrations (20260825130212 add_spot_pressure_rpcs)

-- Exakte Aggregation ueber ein Zeitfenster (keine Downsample-Verzerrung wie
-- bei get_market_series -- fuer Summen muss jede Kerze mitgezaehlt werden).
-- Liefert 0 Zeilen, wenn im Fenster noch keine Kerze vorliegt (z.B. kurz nach
-- Produktivstart des Collectors) -- das Frontend behandelt das transparent
-- als "noch keine Daten" statt eine Null-Zeile zu erfinden.
create or replace function public.get_spot_pressure_summary(p_since timestamptz)
returns table (
  candle_count bigint,
  sum_taker_buy_vol numeric,
  sum_taker_sell_vol numeric,
  sum_taker_buy_quote_vol numeric,
  sum_taker_sell_quote_vol numeric,
  first_price numeric,
  last_price numeric,
  latest_timestamp_utc timestamptz
)
language sql stable
as $$
  select
    count(*) as candle_count,
    sum(m.taker_buy_vol) as sum_taker_buy_vol,
    sum(m.taker_sell_vol) as sum_taker_sell_vol,
    sum(m.taker_buy_quote_vol) as sum_taker_buy_quote_vol,
    sum(m.taker_sell_quote_vol) as sum_taker_sell_quote_vol,
    (array_agg(m.open_price order by m.timestamp_utc asc))[1] as first_price,
    (array_agg(m.last_price order by m.timestamp_utc desc))[1] as last_price,
    max(m.timestamp_utc) as latest_timestamp_utc
  from spot_market_snapshots m
  where m.status = 'ok' and m.exchange = 'binance' and m.timestamp_utc >= p_since
  having count(*) > 0;
$$;

grant execute on function public.get_spot_pressure_summary(timestamptz) to anon, authenticated;

-- Heruntergesamplete Pro-Kerze-Zeitreihe fuer den Buy/Sell-Chart, gleiches
-- Downsampling-Prinzip wie get_market_series (immer erster/letzter Punkt +
-- gleichmaessige Schritte), primaer als Vorsichtsmassnahme falls spaeter
-- laengere Fenster (1W/1M) unterstuetzt werden.
create or replace function public.get_spot_pressure_series(
  p_since timestamptz, p_max_points int default 300
)
returns table (
  timestamp_utc timestamptz,
  last_price numeric,
  taker_buy_vol numeric,
  taker_sell_vol numeric
)
language sql stable
as $$
  with base as (
    select
      m.timestamp_utc, m.last_price, m.taker_buy_vol, m.taker_sell_vol,
      row_number() over (order by m.timestamp_utc asc) as rn,
      count(*) over () as total
    from spot_market_snapshots m
    where m.status = 'ok' and m.exchange = 'binance' and m.timestamp_utc >= p_since
  )
  select base.timestamp_utc, base.last_price, base.taker_buy_vol, base.taker_sell_vol
  from base
  where total <= p_max_points
     or rn = 1 or rn = total
     or rn % greatest(1, ceil(total::numeric / p_max_points)::int) = 0
  order by base.timestamp_utc asc;
$$;

grant execute on function public.get_spot_pressure_series(timestamptz, int) to anon, authenticated;
