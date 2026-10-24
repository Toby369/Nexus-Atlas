-- Exportiert aus supabase_migrations.schema_migrations (20260827065739 create_backtest_hit_rate_evaluation)


create or replace function public.backtest_hit_rate_by_horizon(p_horizons_hours integer[] default array[1,4,24])
returns table (
  horizon_hours integer,
  overall_state text,
  n integer,
  hit_rate_pct numeric,
  avg_forward_return_pct numeric,
  median_forward_return_pct numeric
)
language sql
stable
as $function$
  with horizons as (
    select unnest(p_horizons_hours) as horizon_hours
  ),
  base as (
    select
      bs.candle_open_time,
      bs.domain_result->>'overall_state' as overall_state,
      mf.close_price as price_t
    from public.backtest_states bs
    join market_features mf
      on mf.symbol = 'BTCUSDT' and mf.interval = '1h' and mf.candle_open_time = bs.candle_open_time
    where bs.interval = '1h'
  ),
  fwd as (
    select
      h.horizon_hours,
      b.overall_state,
      b.price_t,
      mf2.close_price as price_fwd,
      case
        when mf2.close_price is null then null
        when b.overall_state = 'BULLISH' then (mf2.close_price > b.price_t)
        when b.overall_state = 'BEARISH' then (mf2.close_price < b.price_t)
        else null
      end as is_hit,
      case when mf2.close_price is not null then ((mf2.close_price - b.price_t) / b.price_t) * 100 end as forward_return_pct
    from base b
    cross join horizons h
    left join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = '1h'
     and mf2.candle_open_time = b.candle_open_time + (h.horizon_hours || ' hours')::interval
  )
  select
    fwd.horizon_hours,
    fwd.overall_state,
    count(*) filter (where fwd.forward_return_pct is not null) as n,
    round(
      100.0 * count(*) filter (where fwd.is_hit = true)
      / nullif(count(*) filter (where fwd.overall_state in ('BULLISH','BEARISH') and fwd.forward_return_pct is not null), 0)
    , 1) as hit_rate_pct,
    round(avg(fwd.forward_return_pct), 4) as avg_forward_return_pct,
    round((percentile_cont(0.5) within group (order by fwd.forward_return_pct))::numeric, 4) as median_forward_return_pct
  from fwd
  where fwd.forward_return_pct is not null
  group by fwd.horizon_hours, fwd.overall_state
  order by fwd.horizon_hours, fwd.overall_state;
$function$;

revoke all on function public.backtest_hit_rate_by_horizon(integer[]) from public;
grant execute on function public.backtest_hit_rate_by_horizon(integer[]) to anon, authenticated, service_role;

create or replace function public.backtest_hit_rate_by_confidence(p_horizons_hours integer[] default array[1,4,24])
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
    select unnest(p_horizons_hours) as horizon_hours
  ),
  base as (
    select
      bs.candle_open_time,
      bs.domain_result->>'overall_state' as overall_state,
      (bs.domain_result->>'confidence')::numeric as confidence,
      mf.close_price as price_t
    from public.backtest_states bs
    join market_features mf
      on mf.symbol = 'BTCUSDT' and mf.interval = '1h' and mf.candle_open_time = bs.candle_open_time
    where bs.interval = '1h' and bs.domain_result->>'overall_state' in ('BULLISH','BEARISH')
  ),
  fwd as (
    select
      h.horizon_hours,
      b.overall_state,
      b.confidence,
      median_conf.med as group_median_confidence,
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
      on mf2.symbol = 'BTCUSDT' and mf2.interval = '1h'
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

revoke all on function public.backtest_hit_rate_by_confidence(integer[]) from public;
grant execute on function public.backtest_hit_rate_by_confidence(integer[]) to anon, authenticated, service_role;
