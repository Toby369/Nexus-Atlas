-- Exportiert aus supabase_migrations.schema_migrations (20260830203817 add_regime_at_anchor_to_anchored_summary)

create or replace function public.get_anchored_summary(p_anchor timestamptz)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
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
  -- Naechstgelegene Regime-Matrix-Zeile vor/bei p_anchor -- gleiches
  -- "nearest point at/before anchor"-Prinzip wie ref_anchor oben, nur fuer
  -- die kategoriale 5-Saeulen-Regime-Engine statt Preis/OI. null, wenn
  -- p_anchor vor dem Beginn der market_state_matrix-Historie liegt (kein
  -- erfundener Wert).
  regime_anchor as (
    select regime, timestamp_utc
    from market_state_matrix
    where timestamp_utc <= p_anchor
    order by timestamp_utc desc
    limit 1
  ),
  -- Confidence des primaeren NEXUS-Assessments zum selben Zeitpunkt --
  -- noetig, damit das Frontend dieselbe Confidence-Sperre
  -- (shouldSuppressRegimeDirectionalLabel) auch auf den historischen
  -- Anker-Wert anwenden kann statt eine Richtungsaussage zu zeigen, die zu
  -- diesem Zeitpunkt eigentlich als "Unklar / kein Zustand" gegolten haette.
  confidence_anchor as (
    select confidence
    from market_states
    where timestamp_utc <= p_anchor
    order by timestamp_utc desc
    limit 1
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
    'regime_at_anchor', (select regime from regime_anchor),
    'regime_at_anchor_timestamp_utc', (select timestamp_utc from regime_anchor),
    'confidence_at_anchor', (select confidence from confidence_anchor),
    'series', coalesce((select jsonb_agg(row_to_json(series) order by series.timestamp_utc) from series), '[]'::jsonb)
  );
$function$;
