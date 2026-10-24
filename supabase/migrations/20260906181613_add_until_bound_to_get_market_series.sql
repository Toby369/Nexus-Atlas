-- Exportiert aus supabase_migrations.schema_migrations (20260906181613 add_until_bound_to_get_market_series)

create or replace function public.get_market_series(
  p_exchange text,
  p_since timestamptz,
  p_max_points integer default 500,
  p_until timestamptz default null
)
returns table(timestamp_utc timestamptz, last_price numeric, open_interest numeric)
language sql
stable
set search_path to 'public'
as $function$
  with bybit_pts as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and m.timestamp_utc >= p_since
      and (p_until is null or m.timestamp_utc <= p_until)
      and p_exchange = 'aggregated'
  ),
  agg as (
    select
      b.timestamp_utc,
      b.last_price,
      sum(oi.open_interest) as open_interest
    from bybit_pts b
    cross join unnest(array['bybit','binance','okx','bitget','pionex']) as ex(exchange)
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
$function$;
