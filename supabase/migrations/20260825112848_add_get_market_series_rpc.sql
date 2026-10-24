-- Exportiert aus supabase_migrations.schema_migrations (20260825112848 add_get_market_series_rpc)

-- Liefert eine zeitlich gleichmaessig heruntergesamplete Preis-/OI-Zeitreihe
-- fuer eine Boerse seit einem Zeitpunkt, begrenzt auf p_max_points Zeilen.
-- Noetig, weil PostgREST auf diesem Projekt Antworten hart bei 1000 Zeilen
-- kappt (bestaetigt: Content-Range 0-999/2268 bei limit=5000) -- ohne
-- serverseitiges Downsampling wuerden 1W/1M-Chartfenster (bis zu ~8600
-- Rohpunkte bei 5-Min-Takt) still und unbemerkt abgeschnitten.
-- Start- und Endpunkt des Fensters sind immer garantiert enthalten, damit
-- die %-Normalisierung im Frontend einen echten, exakten Ankerpunkt hat.
create or replace function public.get_market_series(
  p_exchange text,
  p_since timestamptz,
  p_max_points int default 500
)
returns table (
  timestamp_utc timestamptz,
  last_price numeric,
  open_interest numeric
)
language sql
stable
as $$
  with base as (
    select m.timestamp_utc, m.last_price, m.open_interest,
           row_number() over (order by m.timestamp_utc asc) as rn,
           count(*) over () as total
    from market_snapshots m
    where m.exchange = p_exchange
      and m.status = 'ok'
      and m.timestamp_utc >= p_since
  )
  select base.timestamp_utc, base.last_price, base.open_interest
  from base
  where total <= p_max_points
     or rn = 1
     or rn = total
     or rn % greatest(1, total / p_max_points) = 0
  order by base.timestamp_utc asc;
$$;

grant execute on function public.get_market_series(text, timestamptz, int) to anon, authenticated;
