-- Gesamtmarkt statt nur Binance (Toby 26.11.2026: "moeglichst den gesamten
-- OI oder Spot-Druck abgebildet, ohne explizit zu wissen woher").
-- Spot-Druck zusaetzlich von OKX (Taker-Volumen aller BTC-Spot-Paare, rubik)
-- und Coinbase (BTC-USD, aus den Einzel-Trades). Eigene Tabelle statt
-- spot_market_snapshots: dort lesen collect-candles (Spotpreis fuer die
-- Basis) und die Marktphasen-Funktionen ohne Boersen-Filter und wuerden
-- sonst Boersen mischen. Gezaehlt wird nur in den beiden Spot-Druck-
-- Funktionen (Summe in BTC je 5-Min-Kerze, Preis weiter von Binance).
-- Wachstum: 2 Zeilen je 5 Min (~576/Tag, ~60 kB/Tag), Aufbewahrung 90 Tage.

create table if not exists public.spot_flow_extra (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  exchange text not null,
  taker_buy_vol numeric,
  taker_sell_vol numeric,
  last_price numeric,
  trade_count integer,
  status text not null default 'ok',
  error text,
  created_at timestamptz not null default now(),
  unique (exchange, timestamp_utc)
);
create index if not exists idx_spot_flow_extra_time on public.spot_flow_extra (timestamp_utc desc);

alter table public.spot_flow_extra enable row level security;
create policy "Public read access" on public.spot_flow_extra for select using (true);
revoke all on public.spot_flow_extra from anon, authenticated;
grant select on public.spot_flow_extra to anon, authenticated;
grant select, insert, update, delete on public.spot_flow_extra to service_role;
revoke all on sequence public.spot_flow_extra_id_seq from anon, authenticated;
grant usage, select on sequence public.spot_flow_extra_id_seq to service_role;

-- Spot-Druck-Reihe: Binance-Kerze plus Volumen der anderen Boersen derselben Kerze.
create or replace function public.get_spot_pressure_series(p_since timestamptz, p_max_points integer default 300)
returns table (timestamp_utc timestamptz, last_price numeric, taker_buy_vol numeric, taker_sell_vol numeric)
language sql
stable
set search_path to 'public'
as $$
  with extra as (
    select e.timestamp_utc, sum(e.taker_buy_vol) as buy, sum(e.taker_sell_vol) as sell
    from spot_flow_extra e
    where e.status = 'ok' and e.timestamp_utc >= p_since
    group by e.timestamp_utc
  ),
  base as (
    select
      m.timestamp_utc, m.last_price,
      m.taker_buy_vol + coalesce(x.buy, 0) as taker_buy_vol,
      m.taker_sell_vol + coalesce(x.sell, 0) as taker_sell_vol,
      row_number() over (order by m.timestamp_utc asc) as rn,
      count(*) over () as total
    from spot_market_snapshots m
    left join extra x on x.timestamp_utc = m.timestamp_utc
    where m.status = 'ok' and m.exchange = 'binance' and m.timestamp_utc >= p_since
  )
  select base.timestamp_utc, base.last_price, base.taker_buy_vol, base.taker_sell_vol
  from base
  where total <= p_max_points
     or rn = 1 or rn = total
     or rn % greatest(1, ceil(total::numeric / p_max_points)::int) = 0
  order by base.timestamp_utc asc;
$$;

create or replace function public.get_spot_pressure_summary(p_since timestamptz)
returns table (candle_count bigint, sum_taker_buy_vol numeric, sum_taker_sell_vol numeric, sum_taker_buy_quote_vol numeric, sum_taker_sell_quote_vol numeric, first_price numeric, last_price numeric, latest_timestamp_utc timestamptz)
language sql
stable
set search_path to 'public'
as $$
  with b as (
    select
      count(*) as candle_count,
      sum(m.taker_buy_vol) as buy,
      sum(m.taker_sell_vol) as sell,
      sum(m.taker_buy_quote_vol) as buy_q,
      sum(m.taker_sell_quote_vol) as sell_q,
      (array_agg(m.open_price order by m.timestamp_utc asc))[1] as first_price,
      (array_agg(m.last_price order by m.timestamp_utc desc))[1] as last_price,
      max(m.timestamp_utc) as latest
    from spot_market_snapshots m
    where m.status = 'ok' and m.exchange = 'binance' and m.timestamp_utc >= p_since
  ),
  x as (
    select sum(e.taker_buy_vol) as buy, sum(e.taker_sell_vol) as sell,
           sum(e.taker_buy_vol * e.last_price) as buy_q, sum(e.taker_sell_vol * e.last_price) as sell_q
    from spot_flow_extra e, b
    where e.status = 'ok' and e.timestamp_utc >= p_since and e.timestamp_utc <= b.latest
  )
  select b.candle_count,
         b.buy + coalesce(x.buy, 0),
         b.sell + coalesce(x.sell, 0),
         b.buy_q + coalesce(x.buy_q, 0),
         b.sell_q + coalesce(x.sell_q, 0),
         b.first_price, b.last_price, b.latest
  from b, x
  where b.candle_count > 0;
$$;

create or replace function public.purge_old_snapshots(p_keep interval default '90 days'::interval)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_cutoff timestamptz := now() - p_keep;
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
begin
  delete from market_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('market_snapshots', v_n);
  delete from positioning_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_snapshots', v_n);
  delete from positioning_signals where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_signals', v_n);
  delete from orderbook_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('orderbook_snapshots', v_n);
  delete from macro_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('macro_snapshots', v_n);
  delete from spot_flow_extra where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('spot_flow_extra', v_n);
  delete from news_events where published_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('news_events', v_n);
  return v_result;
end $$;
revoke execute on function public.purge_old_snapshots(interval) from public, anon, authenticated;
grant execute on function public.purge_old_snapshots(interval) to service_role;

-- OI-Summe "Aggregiert": neu auch Hyperliquid und Deribit. Eine Boerse zaehlt
-- nur, wenn sie schon zu Beginn des Fensters Daten hat -- sonst gaebe es
-- beim Hinzufuegen einen kuenstlichen OI-Sprung. Die Referenz-Funktion
-- erfuellt das von selbst (keine Daten am Stichtag = zaehlt nicht).
create or replace function public.get_market_series(p_exchange text, p_since timestamptz, p_max_points integer default 500, p_until timestamptz default null)
returns table (timestamp_utc timestamptz, last_price numeric, open_interest numeric)
language sql
stable
set search_path to 'public'
as $$
  with bybit_pts as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and m.timestamp_utc >= p_since
      and (p_until is null or m.timestamp_utc <= p_until)
      and p_exchange = 'aggregated'
  ),
  -- nur Boersen, die schon zu Fensterbeginn Daten hatten (kein Sprung beim Hinzufuegen)
  ex as (
    select e.exchange
    from unnest(array['bybit','binance','okx','bitget','pionex','hyperliquid','deribit']) as e(exchange)
    where p_exchange = 'aggregated'
      and exists (
        select 1 from market_snapshots m
        where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
          and m.timestamp_utc <= p_since
      )
  ),
  agg as (
    select
      b.timestamp_utc,
      b.last_price,
      sum(oi.open_interest) as open_interest
    from bybit_pts b
    cross join ex
    left join lateral (
      select m.open_interest
      from market_snapshots m
      where m.exchange = ex.exchange
        and m.status = 'ok'
        and m.timestamp_utc <= b.timestamp_utc
        and m.timestamp_utc >= b.timestamp_utc - interval '15 minutes'
      order by m.timestamp_utc desc
      limit 1
    ) oi on true
    group by b.timestamp_utc, b.last_price
  ),
  grouped as (
    select agg.timestamp_utc, agg.last_price, agg.open_interest
    from agg
    where p_exchange = 'aggregated'

    union all

    select m.timestamp_utc, m.last_price, m.open_interest
    from market_snapshots m
    where m.status = 'ok' and m.timestamp_utc >= p_since
      and (p_until is null or m.timestamp_utc <= p_until)
      and m.exchange = p_exchange
      and p_exchange <> 'aggregated'
  ),
  base as (
    select
      grouped.timestamp_utc, grouped.last_price, grouped.open_interest,
      row_number() over (order by grouped.timestamp_utc asc) as rn,
      count(*) over () as total
    from grouped
  )
  select base.timestamp_utc, base.last_price, base.open_interest
  from base
  where total <= p_max_points
     or rn = 1 or rn = total
     or rn % greatest(1, ceil(total::numeric / p_max_points)::int) = 0
  order by base.timestamp_utc asc;
$$;

create or replace function public.get_market_reference_snapshot(p_exchange text, p_cutoff timestamptz)
returns table (timestamp_utc timestamptz, last_price numeric, open_interest numeric)
language sql
stable
set search_path to 'public'
as $$
  with bybit_candidate as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and p_exchange = 'aggregated'
      and m.timestamp_utc <= p_cutoff
    order by m.timestamp_utc desc
    limit 1
  ),
  bybit_fallback as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and p_exchange = 'aggregated'
      and not exists (select 1 from bybit_candidate)
    order by m.timestamp_utc asc
    limit 1
  ),
  bybit_point as (
    select * from bybit_candidate
    union all
    select * from bybit_fallback
  ),
  aggregated as (
    select
      b.timestamp_utc,
      b.last_price,
      sum(oi.open_interest) as open_interest
    from bybit_point b
    cross join unnest(array['bybit','binance','okx','bitget','pionex','hyperliquid','deribit']) as ex(exchange)
    left join lateral (
      select m.open_interest
      from market_snapshots m
      where m.exchange = ex.exchange
        and m.status = 'ok'
        and m.timestamp_utc <= b.timestamp_utc
        and m.timestamp_utc >= b.timestamp_utc - interval '15 minutes'
      order by m.timestamp_utc desc
      limit 1
    ) oi on true
    group by b.timestamp_utc, b.last_price
  ),
  non_aggregated_candidate as (
    select m.timestamp_utc, m.last_price, m.open_interest
    from market_snapshots m
    where m.status = 'ok' and m.timestamp_utc <= p_cutoff and m.exchange = p_exchange
      and p_exchange <> 'aggregated'
    order by m.timestamp_utc desc
    limit 1
  ),
  non_aggregated_fallback as (
    select m.timestamp_utc, m.last_price, m.open_interest
    from market_snapshots m
    where m.status = 'ok' and m.exchange = p_exchange and p_exchange <> 'aggregated'
      and not exists (select 1 from non_aggregated_candidate)
    order by m.timestamp_utc asc
    limit 1
  )
  select * from aggregated
  union all
  select * from non_aggregated_candidate
  union all
  select * from non_aggregated_fallback;
$$;
