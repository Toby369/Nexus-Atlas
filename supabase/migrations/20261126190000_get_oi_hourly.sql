-- OI je Stunde (Toby 26.11.2026): Balken unter dem Spot-Druck in "Wer
-- treibt?". Je Boerse der letzte OI-Wert (USD) jeder Stunde; Aenderung
-- gegen die Vorstunde ueber die Boersen, die in beiden Stunden Daten haben.
-- Die laufende Stunde nimmt den bisher letzten Wert. Nur lesend.
create or replace function public.get_oi_hourly(p_hours integer default 12)
returns table (hour_start timestamptz, change_pct numeric, exchanges integer)
language sql
stable
set search_path to 'public'
as $$
  with s as (
    select date_trunc('hour', timestamp_utc) as h, exchange,
           (array_agg(open_interest_usd order by timestamp_utc desc))[1] as oi
    from public.market_snapshots
    where symbol = 'BTCUSDT' and status = 'ok' and open_interest_usd is not null and open_interest_usd > 0
      and timestamp_utc >= date_trunc('hour', now()) - make_interval(hours => least(greatest(p_hours, 1), 48))
    group by 1, 2
  )
  select cur.h,
         round((sum(cur.oi) / nullif(sum(prev.oi), 0) - 1) * 100, 3),
         count(*)::integer
  from s cur
  join s prev on prev.exchange = cur.exchange and prev.h = cur.h - interval '1 hour'
  group by cur.h
  order by cur.h;
$$;

revoke execute on function public.get_oi_hourly(integer) from public;
grant execute on function public.get_oi_hourly(integer) to anon, authenticated, service_role;
