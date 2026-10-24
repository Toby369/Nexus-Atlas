-- Exportiert aus supabase_migrations.schema_migrations (20260826090203 create_get_liquidation_intelligence)

create or replace function public.get_liquidation_intelligence(
  p_since timestamptz,
  p_bucket_minutes integer default 15,
  p_price_bucket_usd numeric default 200
)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with events as (
    select event_time_utc, side, price, notional_usd
    from liquidation_events
    where status = 'ok' and event_time_utc >= p_since and notional_usd is not null
  ),
  velocity as (
    select
      to_timestamp(floor(extract(epoch from event_time_utc) / (p_bucket_minutes * 60)) * (p_bucket_minutes * 60)) as bucket_start,
      count(*) as event_count,
      sum(notional_usd) as notional_usd,
      sum(notional_usd) filter (where side = 'long') as long_notional,
      sum(notional_usd) filter (where side = 'short') as short_notional
    from events
    group by 1
    order by 1
  ),
  price_clusters as (
    select
      round(price / p_price_bucket_usd) * p_price_bucket_usd as price_bucket,
      sum(notional_usd) as notional_usd,
      count(*) as event_count
    from events
    where price is not null
    group by 1
    order by sum(notional_usd) desc
    limit 5
  ),
  oi_ref as (
    select open_interest, last_price
    from get_market_reference_snapshot('aggregated', now())
  )
  select jsonb_build_object(
    'velocity', coalesce((select jsonb_agg(row_to_json(velocity)) from velocity), '[]'::jsonb),
    'price_clusters', coalesce((select jsonb_agg(row_to_json(price_clusters)) from price_clusters), '[]'::jsonb),
    'total_notional_usd', (select coalesce(sum(notional_usd), 0) from events),
    'total_oi_usd', (select open_interest * last_price from oi_ref)
  );
$$;

comment on function public.get_liquidation_intelligence is 'Phase 2: Liquidations-Erweiterung -- Velocity (Notional je Zeit-Bucket), Preis-Cluster (Haeufungspunkte) und Vergleich vs. aktuellem aggregiertem Open Interest (ueber die bereits fixierte get_market_reference_snapshot-RPC, keine doppelte OI-Logik). p_bucket_minutes/p_price_bucket_usd sind bewusst Parameter, keine Magic Numbers.';
