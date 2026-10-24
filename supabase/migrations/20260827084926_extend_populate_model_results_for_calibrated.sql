-- Exportiert aus supabase_migrations.schema_migrations (20260827084926 extend_populate_model_results_for_calibrated)


create or replace function public.backtest_populate_model_results(p_model_version text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_horizons integer[] := array[24, 168, 720];
  v_inserted integer := 0;
begin
  select * into v_run from backtest_model_runs where model_version = p_model_version;
  if not found then
    raise exception 'backtest_populate_model_results: unbekannte model_version %', p_model_version;
  end if;

  with states as (
    select
      bs.candle_open_time,
      mf.close_price as price_t,
      case v_run.model_family
        when 'baseline' then (public.baseline_signal_state(bs.factors)->>'overall_state')
        when 'domain_balanced' then (bs.domain_result->>'overall_state')
        when 'calibrated' then (public.calibrated_v1_signal_state(bs.factors)->>'overall_state')
      end as overall_state,
      case
        when bs.candle_open_time::date between v_run.train_start and v_run.train_end then 'train'
        when bs.candle_open_time::date between v_run.validation_start and v_run.validation_end then 'validation'
        when bs.candle_open_time::date between v_run.test_start and v_run.test_end then 'test'
      end as split
    from backtest_states bs
    join market_features mf
      on mf.symbol = 'BTCUSDT' and mf.interval = v_run.interval and mf.candle_open_time = bs.candle_open_time
    where bs.interval = v_run.interval and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
  ),
  horizons as (select unnest(v_horizons) as horizon_hours),
  fwd as (
    select
      s.split, h.horizon_hours, s.overall_state, s.price_t,
      mf2.close_price as price_fwd,
      case when mf2.close_price is not null then ((mf2.close_price - s.price_t) / s.price_t) * 100 end as forward_return_pct
    from states s
    cross join horizons h
    left join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = v_run.interval
     and mf2.candle_open_time = s.candle_open_time + (h.horizon_hours || ' hours')::interval
    where s.split is not null
  ),
  baseline as (
    select
      h.horizon_hours, s.split,
      round(100.0 * count(*) filter (where mf2.close_price > s.price_t) / nullif(count(*),0), 1) as pct_rose
    from states s
    cross join horizons h
    left join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = v_run.interval
     and mf2.candle_open_time = s.candle_open_time + (h.horizon_hours || ' hours')::interval
    where s.split is not null
    group by h.horizon_hours, s.split
  ),
  per_direction as (
    select
      f.split, f.horizon_hours,
      d.direction,
      count(*) filter (where f.overall_state = d.direction and f.forward_return_pct is not null) as n,
      round(100.0 * count(*) filter (
        where f.overall_state = d.direction and f.forward_return_pct is not null
        and ((d.direction = 'BULLISH' and f.price_fwd > f.price_t) or (d.direction = 'BEARISH' and f.price_fwd < f.price_t))
      ) / nullif(count(*) filter (where f.overall_state = d.direction and f.forward_return_pct is not null), 0), 1) as hit_rate_pct,
      round(avg(f.forward_return_pct) filter (where f.overall_state = d.direction), 4) as mean_forward_return_pct,
      round((percentile_cont(0.5) within group (order by f.forward_return_pct) filter (where f.overall_state = d.direction))::numeric, 4) as median_forward_return_pct
    from fwd f
    cross join (values ('BULLISH'), ('BEARISH')) as d(direction)
    group by f.split, f.horizon_hours, d.direction
  )
  insert into backtest_model_results (model_version, split, direction, horizon_hours, n, hit_rate_pct, baseline_hit_rate_pct, edge_vs_baseline_pp, mean_forward_return_pct, median_forward_return_pct)
  select
    p_model_version,
    pd.split, pd.direction, pd.horizon_hours, pd.n, pd.hit_rate_pct,
    case when pd.direction = 'BULLISH' then bl.pct_rose else round(100 - bl.pct_rose, 1) end,
    case when pd.direction = 'BULLISH' then round(pd.hit_rate_pct - bl.pct_rose, 1)
         else round(pd.hit_rate_pct - (100 - bl.pct_rose), 1) end,
    pd.mean_forward_return_pct, pd.median_forward_return_pct
  from per_direction pd
  join baseline bl on bl.horizon_hours = pd.horizon_hours and bl.split = pd.split
  on conflict (model_version, split, direction, horizon_hours) do update set
    n = excluded.n, hit_rate_pct = excluded.hit_rate_pct, baseline_hit_rate_pct = excluded.baseline_hit_rate_pct,
    edge_vs_baseline_pp = excluded.edge_vs_baseline_pp, mean_forward_return_pct = excluded.mean_forward_return_pct,
    median_forward_return_pct = excluded.median_forward_return_pct, computed_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
