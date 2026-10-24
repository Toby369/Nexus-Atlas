-- Exportiert aus supabase_migrations.schema_migrations (20260825151345 fix_aggregated_reference_snapshot_null_bug)

-- Bugfix: get_market_reference_snapshot('aggregated', ...) konnte eine
-- Zeile mit last_price=NULL und open_interest=NULL liefern, wenn der
-- gewaehlte Zeitstempel (naechster vor p_cutoff, oder aeltester
-- verfuegbarer als Fallback) zufaellig ein Moment war, an dem Bybit
-- selbst keine Zeile hatte (z.B. ganz am Anfang der Historie, bevor alle
-- Boersen exakt synchron liefen). Der Preis kommt ausschliesslich aus
-- Bybit (filter (where exchange='bybit')) -- fehlt Bybit an genau diesem
-- Zeitstempel, wird last_price NULL, obwohl echte, brauchbare Daten
-- Sekunden davor/danach existieren. Live entdeckt: "1W" zeigte
-- "INSUFFICIENT DATA" trotz vorhandener 7-Tage-Historie.
--
-- Fix: fuer p_exchange='aggregated' nur Zeitstempel betrachten, an denen
-- Bybit nachweislich eine Zeile hat -- garantiert einen echten last_price
-- und ein OI, das mindestens Bybits eigenes (nie NULL) enthaelt.
create or replace function public.get_market_reference_snapshot(
  p_exchange text, p_cutoff timestamptz
)
returns table (timestamp_utc timestamptz, last_price numeric, open_interest numeric)
language sql stable
as $$
  with bybit_ts as (
    select m.timestamp_utc
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and p_exchange = 'aggregated'
  ),
  candidate as (
    (
      select
        m.timestamp_utc,
        max(m.last_price) filter (where m.exchange = 'bybit') as last_price,
        sum(m.open_interest) as open_interest
      from market_snapshots m
      where m.status = 'ok' and m.timestamp_utc <= p_cutoff and p_exchange = 'aggregated'
        and m.timestamp_utc in (select timestamp_utc from bybit_ts)
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
        and m.timestamp_utc in (select timestamp_utc from bybit_ts)
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
