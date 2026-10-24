-- Exportiert aus supabase_migrations.schema_migrations (20260827185000 create_nonoverlapping_7d_robustness_check)


-- Phase 1, Non-Overlapping 7D Robustness Check. Nur jede 7. Zeile je Split
-- bekommt ueberhaupt ein Label (row_number() ueber candle_open_time,
-- Start bei der jeweils ersten Zeile des Splits) -- keine ueberlappenden
-- 7-Tage-Fenster. Purge+Embargo gelten weiterhin fuer das letzte Fenster
-- an der Split-Grenze.
create or replace function public.research_evaluate_nonoverlap_7d(
  p_model_version text,
  p_family text,
  p_embargo_days integer default 1
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_inserted integer := 0;
begin
  select * into v_run from backtest_model_runs where model_version = p_model_version;
  if not found then
    raise exception 'research_evaluate_nonoverlap_7d: unbekannte model_version %', p_model_version;
  end if;

  with splits as (select unnest(array['train','validation']) as split),
  base_rows as (
    select
      bs.candle_open_time,
      mf.close_price as price_t,
      s.split,
      row_number() over (partition by s.split order by bs.candle_open_time) as rn,
      case v_run.model_family
        when 'domain_balanced' then (case p_family
          when 'domain_balanced_covfix' then public.experimental_domain_signal_state_covfix(bs.factors)
          else bs.domain_result end)
        when 'calibrated' then public.calibrated_v1_signal_state_covfix(bs.factors)
        when 'redundancy_aware' then public.redundancy_aware_v1_signal_state(bs.factors)
      end ->> 'overall_state' as overall_state
    from backtest_states bs
    join market_features mf on mf.symbol='BTCUSDT' and mf.interval=v_run.interval and mf.candle_open_time=bs.candle_open_time
    cross join splits s
    where bs.interval = v_run.interval and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
      and bs.candle_open_time::date between
        (case s.split when 'train' then v_run.train_start else v_run.validation_start end)
        and (case s.split when 'train' then v_run.train_end else v_run.validation_end end)
  ),
  non_overlap as (
    -- rn=1,8,15,... -> jede 7. Zeile, keine ueberlappenden 7-Tage-Fenster
    select * from base_rows where (rn - 1) % 7 = 0
  ),
  fwd as (
    select
      n.split, n.overall_state, n.price_t, n.candle_open_time,
      mf2.close_price as price_fwd,
      (case n.split when 'train' then v_run.validation_start::timestamptz else v_run.test_start::timestamptz end) as boundary
    from non_overlap n
    left join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = v_run.interval
     and mf2.candle_open_time = n.candle_open_time + interval '168 hours'
  ),
  purged_fwd as (
    select * from fwd
    where (candle_open_time + interval '168 hours') < boundary
      and candle_open_time <= boundary - (p_embargo_days || ' days')::interval
      and price_fwd is not null
  ),
  baseline as (
    select split, round(100.0 * count(*) filter (where price_fwd > price_t) / nullif(count(*),0), 1) as pct_rose, count(*) as n_survive
    from purged_fwd group by split
  ),
  raw_counts as (
    select split, count(*) as n_total from non_overlap group by split
  ),
  per_direction as (
    select
      pf.split, d.direction,
      count(*) filter (where pf.overall_state = d.direction) as n,
      round(100.0 * count(*) filter (
        where pf.overall_state = d.direction
        and ((d.direction = 'BULLISH' and pf.price_fwd > pf.price_t) or (d.direction = 'BEARISH' and pf.price_fwd < pf.price_t))
      ) / nullif(count(*) filter (where pf.overall_state = d.direction), 0), 1) as hit_rate_pct,
      round(avg(((pf.price_fwd - pf.price_t) / pf.price_t) * 100) filter (where pf.overall_state = d.direction), 4) as mean_forward_return_pct,
      round((percentile_cont(0.5) within group (order by ((pf.price_fwd - pf.price_t) / pf.price_t) * 100) filter (where pf.overall_state = d.direction))::numeric, 4) as median_forward_return_pct
    from purged_fwd pf
    cross join (values ('BULLISH'), ('BEARISH')) as d(direction)
    group by pf.split, d.direction
  )
  insert into research_model_results_purged
    (model_version, family, split, horizon_hours, embargo_days, overlap_mode, direction, n, n_purged_out, hit_rate_pct, baseline_hit_rate_pct, edge_vs_baseline_pp, mean_forward_return_pct, median_forward_return_pct, validity_status)
  select
    p_model_version, p_family, pd.split, 168, p_embargo_days, 'non_overlapping', pd.direction,
    pd.n,
    coalesce(rc.n_total,0) - bl.n_survive,
    pd.hit_rate_pct,
    case when pd.direction='BULLISH' then bl.pct_rose else round(100-bl.pct_rose,1) end,
    case when pd.direction='BULLISH' then round(pd.hit_rate_pct - bl.pct_rose, 1)
         else round(pd.hit_rate_pct - (100 - bl.pct_rose), 1) end,
    pd.mean_forward_return_pct, pd.median_forward_return_pct,
    'POST_PURGE_EMBARGO_CORRECTED'
  from per_direction pd
  join baseline bl on bl.split=pd.split
  left join raw_counts rc on rc.split=pd.split
  on conflict (model_version, family, split, horizon_hours, embargo_days, overlap_mode, direction) do update set
    n=excluded.n, n_purged_out=excluded.n_purged_out, hit_rate_pct=excluded.hit_rate_pct,
    baseline_hit_rate_pct=excluded.baseline_hit_rate_pct, edge_vs_baseline_pp=excluded.edge_vs_baseline_pp,
    mean_forward_return_pct=excluded.mean_forward_return_pct, median_forward_return_pct=excluded.median_forward_return_pct,
    computed_at=now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.research_evaluate_nonoverlap_7d(text, text, integer) from public, anon, authenticated;
grant execute on function public.research_evaluate_nonoverlap_7d(text, text, integer) to service_role;
