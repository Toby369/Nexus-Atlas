-- Exportiert aus supabase_migrations.schema_migrations (20260827075528 generalize_hit_rate_confidence_by_interval)


drop function if exists public.backtest_hit_rate_by_confidence(integer[], text);

create function public.backtest_hit_rate_by_confidence(
  p_horizons_hours integer[] default null,
  p_architecture_version text default 'experimental_domain_v2_phase4_full_asof',
  p_interval text default '1h'
)
returns table (
  horizon_hours integer,
  overall_state text,
  confidence_bucket text,
  n integer,
  hit_rate_pct numeric,
  avg_forward_return_pct numeric
)
language sql
stable
as $function$
  with horizons as (
    select unnest(
      coalesce(
        p_horizons_hours,
        case p_interval
          when '1h' then array[1,4,24]
          when '4h' then array[4,24,96]
          when '1d' then array[24,168,720]
          else array[1,4,24]
        end
      )
    ) as horizon_hours
  ),
  base as (
    select
      bs.candle_open_time,
      bs.domain_result->>'overall_state' as overall_state,
      (bs.domain_result->>'confidence')::numeric as confidence,
      mf.close_price as price_t
    from public.backtest_states bs
    join market_features mf
      on mf.symbol = 'BTCUSDT' and mf.interval = p_interval and mf.candle_open_time = bs.candle_open_time
    where bs.interval = p_interval and bs.architecture_version = p_architecture_version
      and bs.domain_result->>'overall_state' in ('BULLISH','BEARISH')
  ),
  fwd as (
    select
      h.horizon_hours,
      b.overall_state,
      b.confidence,
      case when b.confidence >= median_conf.med then 'HIGH (>= Median)' else 'LOW (< Median)' end as confidence_bucket,
      case
        when mf2.close_price is null then null
        when b.overall_state = 'BULLISH' then (mf2.close_price > b.price_t)
        else (mf2.close_price < b.price_t)
      end as is_hit,
      case when mf2.close_price is not null then ((mf2.close_price - b.price_t) / b.price_t) * 100 end as forward_return_pct
    from base b
    cross join horizons h
    left join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = p_interval
     and mf2.candle_open_time = b.candle_open_time + (h.horizon_hours || ' hours')::interval
    join lateral (
      select percentile_cont(0.5) within group (order by b2.confidence) as med
      from base b2 where b2.overall_state = b.overall_state
    ) median_conf on true
  )
  select
    fwd.horizon_hours,
    fwd.overall_state,
    fwd.confidence_bucket,
    count(*) filter (where fwd.forward_return_pct is not null) as n,
    round(100.0 * count(*) filter (where fwd.is_hit = true) / nullif(count(*) filter (where fwd.forward_return_pct is not null), 0), 1) as hit_rate_pct,
    round(avg(fwd.forward_return_pct), 4) as avg_forward_return_pct
  from fwd
  where fwd.forward_return_pct is not null
  group by fwd.horizon_hours, fwd.overall_state, fwd.confidence_bucket
  order by fwd.horizon_hours, fwd.overall_state, fwd.confidence_bucket;
$function$;

revoke all on function public.backtest_hit_rate_by_confidence(integer[], text, text) from public;
grant execute on function public.backtest_hit_rate_by_confidence(integer[], text, text) to anon, authenticated, service_role;
