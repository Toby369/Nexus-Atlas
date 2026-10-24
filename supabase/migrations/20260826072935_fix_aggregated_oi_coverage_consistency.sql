-- Exportiert aus supabase_migrations.schema_migrations (20260826072935 fix_aggregated_oi_coverage_consistency)

-- Behebt einen Datenqualitaets-Bug: die "aggregated"-OI-Summe zaehlte bisher
-- an jedem Zeitpunkt unabhaengig nur die Boersen mit status='ok' zu genau
-- diesem Tick. Faellt eine Boerse fuer einen einzigen 5-Min-Tick transient
-- aus (Timeout o.ae.), sackt die Summe an diesem Tick kuenstlich ab und
-- springt beim naechsten Tick wieder hoch -- ein Sprung, der nichts mit
-- echter Open-Interest-Bewegung zu tun hat. Nachgewiesen u.a. am
-- 2026-08-26 03:45-03:50 UTC: Abdeckung fiel von 5 auf 4 Boersen und
-- zurueck -> kuenstlicher Sprung von -13.5% / +15.6% ohne reale Bewegung.
--
-- Fix: fuer die "aggregated"-Summe wird pro Boerse (bybit/binance/okx/
-- bitget/pionex) der letzte bekannte status='ok'-Wert innerhalb eines
-- 15-Minuten-Toleranzfensters verwendet (asof/forward-fill), statt nur den
-- exakten Tick zu zaehlen -- dieselbe 15-Minuten-Toleranz, die im Code
-- bereits als HISTORY_GAP_TOLERANCE_MS etabliert ist. Ein einzelner
-- verpasster Tick "verschwindet" dadurch nicht mehr aus der Summe. Bitunix
-- bleibt wie bisher aussen vor (liefert nie OI).

CREATE OR REPLACE FUNCTION public.get_market_series(p_exchange text, p_since timestamp with time zone, p_max_points integer DEFAULT 500)
 RETURNS TABLE(timestamp_utc timestamp with time zone, last_price numeric, open_interest numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with bybit_pts as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and m.timestamp_utc >= p_since and p_exchange = 'aggregated'
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
    where m.status = 'ok' and m.timestamp_utc >= p_since and m.exchange = p_exchange
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

CREATE OR REPLACE FUNCTION public.get_market_reference_snapshot(p_exchange text, p_cutoff timestamp with time zone)
 RETURNS TABLE(timestamp_utc timestamp with time zone, last_price numeric, open_interest numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;
