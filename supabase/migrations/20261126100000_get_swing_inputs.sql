-- Swing-Belege (Toby 26.11.2026): Fuer Swing-Cluster prueft der Setup-Rechner
-- auf 4H statt 15m, Spot ueber 24 h und 7 Tage und den ETF-Fluss der letzten
-- 5 Handelstage. Alles in EINER Abfrage (1 Anfrage je 5-Min-Laden der Karte,
-- im Server-Push bereits in get_setup_inputs enthalten). Keine neue Tabelle,
-- kein Speicherzuwachs. Liest nur oeffentlich lesbare Tabellen.
create or replace function public.get_swing_inputs()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'candles4h', coalesce((
      select jsonb_agg(c order by c.open_time) from (
        select open_time, open, high, low, close, volume from public.candles
        where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '4h'
          and open_time + interval '4 hours' <= now()
        order by open_time desc limit 240) c
    ), '[]'::jsonb),
    'spot24h', (select jsonb_build_object('buy', s.sum_taker_buy_vol, 'sell', s.sum_taker_sell_vol)
                from public.get_spot_pressure_summary(now() - interval '24 hours') s),
    'spot7d', (select jsonb_build_object('buy', s.sum_taker_buy_vol, 'sell', s.sum_taker_sell_vol)
               from public.get_spot_pressure_summary(now() - interval '7 days') s),
    'etf', coalesce((
      select jsonb_agg(jsonb_build_object('flow_date', e.flow_date, 'usd_m', e.total_flow_usd_m) order by e.flow_date desc)
      from (select distinct on (flow_date) flow_date, total_flow_usd_m from public.etf_flows
            where total_flow_usd_m is not null order by flow_date desc, created_at desc limit 5) e
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_swing_inputs() from public;
grant execute on function public.get_swing_inputs() to anon, authenticated, service_role;

-- Server-Push: Swing-Eingaben mitliefern (sonst unveraendert gegenueber 20261126090000).
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
    'events', coalesce((select jsonb_agg(jsonb_build_object('event_key', event_key, 'event_date', event_date)) from public.economic_calendar_events where event_date is not null), '[]'::jsonb),
    'swing', public.get_swing_inputs()
  );
$$;

revoke execute on function public.get_setup_inputs() from public, anon, authenticated;
grant execute on function public.get_setup_inputs() to service_role;
