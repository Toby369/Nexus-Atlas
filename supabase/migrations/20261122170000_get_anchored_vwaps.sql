-- AVWAP aus Tobys AutarkTrade-Zeichnungen (Setup-Rechner, 22.11.2026).
-- AutarkTrade speichert nur den Anker; der Chart rechnet
-- Summe(v * hlc3) / Summe(v) ab der Ankerkerze. Nexus rechnet gleich, auf
-- Binance-15m-Kerzen (BTCUSDT Perp), fuer mehrere Anker in einem Aufruf.
-- Am 22.11. 07:15 ergab der Anker 21.11. 06:15 UTC 58'958 -- wie Tobys Chart.
create or replace function public.get_anchored_vwaps(p_anchors timestamptz[])
returns table (anchor timestamptz, vwap numeric, candles integer)
language sql
stable
set search_path to 'public'
as $$
  select a.anchor,
         sum((c.high + c.low + c.close) / 3.0 * c.volume) / nullif(sum(c.volume), 0),
         count(c.*)::integer
  from unnest(p_anchors[1:10]) as a(anchor)
  left join public.candles c
    on c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = '15m'
   and c.open_time >= date_trunc('hour', a.anchor) + floor(extract(minute from a.anchor) / 15) * interval '15 minutes'
  group by a.anchor;
$$;

revoke execute on function public.get_anchored_vwaps(timestamptz[]) from public;
grant execute on function public.get_anchored_vwaps(timestamptz[]) to anon, authenticated, service_role;
