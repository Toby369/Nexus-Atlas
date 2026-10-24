-- Exportiert aus supabase_migrations.schema_migrations (20260828221941 add_dashboard_poll_bundle_rpc)

-- Phase 2, Punkt 3: buendelt die Client-seitigen 30s-Polls von
-- MarketContextCard, SpotPressurePanel und PositioningPanel (bisher 10
-- unabhaengige Einzel-Requests: 3x market series/reference/spot-summary,
-- 2x spot-pressure summary/series, 5x positioning snapshots/signal) zu
-- einem einzigen RPC-Aufruf, um Egress-Kosten und Latenz zu reduzieren.
-- Nutzt exakt dieselben, bereits bestehenden RPCs/Tabellen wie die
-- Einzelabfragen (kein neues Datenmodell, keine Verhaltensaenderung) --
-- lediglich zu einem jsonb-Objekt gebuendelt.
create or replace function public.get_dashboard_poll_bundle(
  p_since timestamptz,
  p_max_points integer default 500
)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'oi_series', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from public.get_market_series('aggregated', p_since, p_max_points) s
    ),
    'oi_reference', (
      select row_to_json(r)
      from public.get_market_reference_snapshot('aggregated', p_since) r
    ),
    'spot_summary', (
      select row_to_json(sp) from public.get_spot_pressure_summary(p_since) sp
    ),
    'spot_series', (
      select coalesce(jsonb_agg(row_to_json(ss)), '[]'::jsonb)
      from public.get_spot_pressure_series(p_since, p_max_points) ss
    ),
    'exchange_first_seen', (
      select coalesce(jsonb_agg(row_to_json(ef)), '[]'::jsonb)
      from public.get_market_snapshot_exchange_first_seen() ef
    ),
    'positioning_binance', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'binance' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_bybit', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'bybit' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_okx', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'okx' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_bitget', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'bitget' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_signal', (
      select row_to_json(ps) from (
        select * from public.positioning_signals
        order by timestamp_utc desc limit 1
      ) ps
    )
  );
$$;

grant execute on function public.get_dashboard_poll_bundle(timestamptz, integer) to anon, authenticated;
