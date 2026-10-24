-- Exportiert aus supabase_migrations.schema_migrations (20260827072624 add_baseline_to_backtest_hit_rate_v2)


drop function if exists public.backtest_hit_rate_by_horizon(integer[]);

create function public.backtest_hit_rate_by_horizon(p_horizons_hours integer[] default array[1,4,24])
returns table (
  horizon_hours integer,
  overall_state text,
  n integer,
  hit_rate_pct numeric,
  baseline_hit_rate_pct numeric,
  edge_vs_baseline_pp numeric,
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
  ),
  baseline as (
    select
      h.horizon_hours,
      round(100.0 * count(*) filter (where mf2.close_price > mf1.close_price) / count(*), 1) as pct_rose
    from market_features mf1
    cross join horizons h
    join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = '1h'
     and mf2.candle_open_time = mf1.candle_open_time + (h.horizon_hours || ' hours')::interval
    where mf1.symbol = 'BTCUSDT' and mf1.interval = '1h'
    group by h.horizon_hours
  )
  select
    fwd.horizon_hours,
    fwd.overall_state,
    count(*) filter (where fwd.forward_return_pct is not null) as n,
    round(
      100.0 * count(*) filter (where fwd.is_hit = true)
      / nullif(count(*) filter (where fwd.overall_state in ('BULLISH','BEARISH') and fwd.forward_return_pct is not null), 0)
    , 1) as hit_rate_pct,
    case when fwd.overall_state = 'BULLISH' then bl.pct_rose
         when fwd.overall_state = 'BEARISH' then round(100 - bl.pct_rose, 1)
         else null end as baseline_hit_rate_pct,
    case when fwd.overall_state = 'BULLISH' then
           round(
             100.0 * count(*) filter (where fwd.is_hit = true) / nullif(count(*) filter (where fwd.overall_state = 'BULLISH' and fwd.forward_return_pct is not null), 0)
             - bl.pct_rose
           , 1)
         when fwd.overall_state = 'BEARISH' then
           round(
             100.0 * count(*) filter (where fwd.is_hit = true) / nullif(count(*) filter (where fwd.overall_state = 'BEARISH' and fwd.forward_return_pct is not null), 0)
             - (100 - bl.pct_rose)
           , 1)
         else null end as edge_vs_baseline_pp,
    round(avg(fwd.forward_return_pct), 4) as avg_forward_return_pct,
    round((percentile_cont(0.5) within group (order by fwd.forward_return_pct))::numeric, 4) as median_forward_return_pct
  from fwd
  join baseline bl on bl.horizon_hours = fwd.horizon_hours
  where fwd.forward_return_pct is not null
  group by fwd.horizon_hours, fwd.overall_state, bl.pct_rose
  order by fwd.horizon_hours, fwd.overall_state;
$function$;

revoke all on function public.backtest_hit_rate_by_horizon(integer[]) from public;
grant execute on function public.backtest_hit_rate_by_horizon(integer[]) to anon, authenticated, service_role;
