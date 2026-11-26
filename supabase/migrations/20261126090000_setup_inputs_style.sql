-- Setup-Rechner (Toby 26.11.2026): auch Trendlinien, Kanaele und Fibonacci.
-- Dafuer braucht der Server den Stil der Zeichnungen (rechts/links verlaengert,
-- Fib-Stufen). Sonst unveraendert gegenueber 20261124090000.
create or replace function public.get_setup_inputs()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'drawings', coalesce((select jsonb_agg(jsonb_build_object('autark_id', autark_id, 'kind', kind, 'label', label, 'points', points, 'style', style)) from public.autark_drawings), '[]'::jsonb),
    'avwaps', coalesce((
      select jsonb_agg(jsonb_build_object('autark_id', d.autark_id, 'vwap', v.vwap))
      from public.autark_drawings d
      cross join lateral public.get_anchored_vwaps(array[to_timestamp((d.points->0->>'t')::double precision / 1000)]) v
      where d.kind = 'avwap' and jsonb_array_length(d.points) > 0
    ), '[]'::jsonb),
    'anchored', public.get_anchored_vwap_summary(),
    'candles15m', coalesce((
      select jsonb_agg(c order by c.open_time) from (
        select open_time, open, high, low, close, volume from public.candles
        where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '15m'
          and open_time + interval '15 minutes' <= now()
        order by open_time desc limit 300) c
    ), '[]'::jsonb),
    'candles1h', coalesce((
      select jsonb_agg(c order by c.open_time) from (
        select open_time, open, high, low, close, volume from public.candles
        where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
          and open_time + interval '1 hour' <= now()
        order by open_time desc limit 20) c
    ), '[]'::jsonb),
    'spot', coalesce((select jsonb_agg(s) from public.get_spot_pressure_series(now() - interval '12 hours', 300) s), '[]'::jsonb),
    'funding_rate', (select funding_rate from public.market_snapshots where exchange = 'binance' and symbol = 'BTCUSDT' and status = 'ok' order by timestamp_utc desc limit 1),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event_key', event_key, 'event_date', event_date)) from public.economic_calendar_events where event_date is not null), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_setup_inputs() from public, anon, authenticated;
grant execute on function public.get_setup_inputs() to service_role;
