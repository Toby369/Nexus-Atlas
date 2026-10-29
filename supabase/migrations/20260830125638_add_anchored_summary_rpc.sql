-- Exportiert aus supabase_migrations.schema_migrations (20260830125638 add_anchored_summary_rpc)

-- Anchored Analytics, Phase 1 (Proposal 1 aus dem Feasibility-Review):
-- aggregiert Liquidationen, OI- und Preis-Veraenderung AB einem frei
-- waehlbaren Ankerpunkt, statt der festen Timeframes in lib/timeframes.ts.
-- Bewusst NUR die drei bereits ohne neue Dateninfrastruktur anchor-faehigen
-- Groessen: Liquidationen und OI/Preis basieren auf bereits
-- zeitgestempelten Rohereignissen (liquidation_events, market_snapshots) --
-- CVD/VWAP sind bewusst NICHT Teil dieser Phase, da sie nur pro Kerze (1H+)
-- vorliegen und keine Minutenpraezision fuer einen beliebigen Ankerpunkt
-- zulassen wuerden.
--
-- compute-market-state und lib/marketStateSummary.ts bleiben unberuehrt
-- (Einfrier-Garantie, PHASE-0-RECONCILIATION.md Abschnitt 17) -- diese RPC
-- ist eine vollstaendig eigenstaendige, zusaetzliche Betrachtung.
--
-- Granularitaets-Staffelung der Zeitreihe (Payload-Schutz bei alten
-- Ankerpunkten):
--   < 6h    : rohe market_snapshots (~5-Minuten-Takt, ueber get_market_series)
--   6h-3d   : market_features 1H-Kerzen
--   3d-14d  : market_features 4H-Kerzen
--   > 14d   : market_features 1D-Kerzen
-- Referenzwerte (Preis/OI "at anchor"/"current") nutzen die bereits
-- bestehende get_market_reference_snapshot()-Asof-Lookup-Funktion --
-- keine doppelte OI-Aggregationslogik (Spec-Vorgabe, siehe Kommentar in
-- collect-candles).
create or replace function public.get_anchored_summary(p_anchor timestamptz)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with tier as (
    select
      case
        when now() - p_anchor < interval '6 hours' then '5m'
        when now() - p_anchor <= interval '3 days' then '1h'
        when now() - p_anchor <= interval '14 days' then '4h'
        else '1d'
      end as granularity
  ),
  liq as (
    select
      coalesce(sum(notional_usd) filter (where side = 'long'), 0) as long_notional,
      coalesce(sum(notional_usd) filter (where side = 'short'), 0) as short_notional,
      count(*) as event_count
    from liquidation_events
    where status = 'ok' and event_time_utc >= p_anchor and notional_usd is not null
  ),
  ref_anchor as (
    select last_price, open_interest from get_market_reference_snapshot('aggregated', p_anchor)
  ),
  ref_now as (
    select last_price, open_interest from get_market_reference_snapshot('aggregated', now())
  ),
  series_5m as (
    select s.timestamp_utc, s.last_price, s.open_interest
    from tier, get_market_series('aggregated', p_anchor, 500) s
    where tier.granularity = '5m'
  ),
  series_candles as (
    select mf.candle_open_time as timestamp_utc, mf.close_price as last_price, mf.oi_current as open_interest
    from tier
    join market_features mf
      on mf.symbol = 'BTCUSDT'
      and mf.candle_open_time >= p_anchor
      and (
        (tier.granularity = '1h' and mf.interval = '1h')
        or (tier.granularity = '4h' and mf.interval = '4h')
        or (tier.granularity = '1d' and mf.interval = '1d')
      )
    order by mf.candle_open_time asc
    limit 500
  ),
  series as (
    select * from series_5m
    union all
    select * from series_candles
  )
  select jsonb_build_object(
    'anchor_timestamp_utc', p_anchor,
    'granularity_used', (select granularity from tier),
    'price_at_anchor', (select last_price from ref_anchor),
    'price_current', (select last_price from ref_now),
    'price_change_pct', (
      select case
        when ref_anchor.last_price is null or ref_anchor.last_price = 0 or ref_now.last_price is null then null
        else ((ref_now.last_price - ref_anchor.last_price) / ref_anchor.last_price) * 100
      end
      from ref_anchor, ref_now
    ),
    'oi_at_anchor', (select open_interest from ref_anchor),
    'oi_current', (select open_interest from ref_now),
    'oi_change_pct', (
      select case
        when ref_anchor.open_interest is null or ref_anchor.open_interest = 0 or ref_now.open_interest is null then null
        else ((ref_now.open_interest - ref_anchor.open_interest) / ref_anchor.open_interest) * 100
      end
      from ref_anchor, ref_now
    ),
    'long_liquidation_usd', (select long_notional from liq),
    'short_liquidation_usd', (select short_notional from liq),
    'liquidation_event_count', (select event_count from liq),
    'series', coalesce((select jsonb_agg(row_to_json(series) order by series.timestamp_utc) from series), '[]'::jsonb)
  );
$$;

grant execute on function public.get_anchored_summary(timestamptz) to anon, authenticated;
