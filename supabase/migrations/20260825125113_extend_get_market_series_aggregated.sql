-- Exportiert aus supabase_migrations.schema_migrations (20260825125113 extend_get_market_series_aggregated)

-- Erweitert get_market_series um einen "aggregated"-Pseudo-Boersen-Wert:
-- Open Interest wird ueber alle Boersen mit status='ok' zum selben
-- timestamp_utc summiert (echte, gemessene Werte -- keine Schaetzung), der
-- Preis kommt weiterhin von Bybit als Referenzboerse. Alle collect-btc-
-- Boersen schreiben pro Lauf denselben timestamp_utc, daher ist die
-- Gruppierung nach timestamp_utc exakt (kein Zeitversatz zwischen Boersen).
-- Boersen ohne oeffentliche OI-Route (z.B. Bitunix) tragen einfach nichts
-- zur Summe bei (NULL wird von sum() ignoriert) statt einen Wert zu erfinden.
create or replace function public.get_market_series(
  p_exchange text, p_since timestamptz, p_max_points int default 500
)
returns table (timestamp_utc timestamptz, last_price numeric, open_interest numeric)
language sql stable
as $$
  with grouped as (
    select
      m.timestamp_utc,
      max(m.last_price) filter (where m.exchange = 'bybit') as last_price,
      sum(m.open_interest) as open_interest
    from market_snapshots m
    where m.status = 'ok' and m.timestamp_utc >= p_since and p_exchange = 'aggregated'
    group by m.timestamp_utc

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
$$;

grant execute on function public.get_market_series(text, timestamptz, int) to anon, authenticated;

-- Analoges Gegenstueck zur Client/Server-Referenzpunkt-Abfrage
-- (fetchReferenceSnapshot/getOiReferenceSnapshot), jetzt auch fuer
-- "aggregated" nutzbar. Faellt wie im Original auf den aeltesten
-- verfuegbaren Punkt zurueck statt zu approximieren, falls die Historie
-- noch nicht so weit zurueckreicht.
create or replace function public.get_market_reference_snapshot(
  p_exchange text, p_cutoff timestamptz
)
returns table (timestamp_utc timestamptz, last_price numeric, open_interest numeric)
language sql stable
as $$
  with candidate as (
    (
      select
        m.timestamp_utc,
        max(m.last_price) filter (where m.exchange = 'bybit') as last_price,
        sum(m.open_interest) as open_interest
      from market_snapshots m
      where m.status = 'ok' and m.timestamp_utc <= p_cutoff and p_exchange = 'aggregated'
      group by m.timestamp_utc
      order by m.timestamp_utc desc
      limit 1
    )
    union all
    (
      select m.timestamp_utc, m.last_price, m.open_interest
      from market_snapshots m
      where m.status = 'ok' and m.timestamp_utc <= p_cutoff and m.exchange = p_exchange
        and p_exchange <> 'aggregated'
      order by m.timestamp_utc desc
      limit 1
    )
  ),
  fallback as (
    (
      select
        m.timestamp_utc,
        max(m.last_price) filter (where m.exchange = 'bybit') as last_price,
        sum(m.open_interest) as open_interest
      from market_snapshots m
      where m.status = 'ok' and p_exchange = 'aggregated'
        and not exists (select 1 from candidate)
      group by m.timestamp_utc
      order by m.timestamp_utc asc
      limit 1
    )
    union all
    (
      select m.timestamp_utc, m.last_price, m.open_interest
      from market_snapshots m
      where m.status = 'ok' and m.exchange = p_exchange and p_exchange <> 'aggregated'
        and not exists (select 1 from candidate)
      order by m.timestamp_utc asc
      limit 1
    )
  )
  select * from candidate
  union all
  select * from fallback;
$$;

grant execute on function public.get_market_reference_snapshot(text, timestamptz) to anon, authenticated;
