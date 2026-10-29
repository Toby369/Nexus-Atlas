-- Exportiert aus supabase_migrations.schema_migrations (20260904174047 candlestick_pattern_purged_evaluation_v2)


create table if not exists public.research_pattern_results_purged (
  pattern_name text not null,
  interval text not null,
  direction_expected text not null,
  split text not null,
  horizon_hours integer not null,
  embargo_days numeric not null,
  n integer not null,
  n_purged_out integer not null,
  hit_rate_pct numeric,
  baseline_hit_rate_pct numeric,
  edge_vs_baseline_pp numeric,
  mean_forward_return_pct numeric,
  median_forward_return_pct numeric,
  computed_at timestamptz not null default now(),
  primary key (pattern_name, interval, direction_expected, split, horizon_hours)
);
alter table public.research_pattern_results_purged enable row level security;
create policy research_pattern_results_purged_select_all on public.research_pattern_results_purged for select to public using (true);

create or replace function public.research_evaluate_patterns_purged(p_interval text, p_horizons integer[], p_embargo_days numeric)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_train_start date := '2024-09-04';
  v_train_end   date := '2026-01-14';
  v_val_start   date := '2026-01-15';
  v_val_end     date := '2026-05-14';
  v_test_start  date := '2026-05-15';
  v_h integer;
  v_split text;
  v_boundary timestamptz;
  v_inserted integer := 0;
  v_rc integer;
begin
  foreach v_h in array p_horizons loop
    foreach v_split in array array['train','validation'] loop
      v_boundary := case v_split when 'train' then v_val_start::timestamptz else v_test_start::timestamptz end;

      with split_candles as (
        select open_time, close
        from candles
        where symbol = 'BTCUSDT' and interval = p_interval
          and open_time::date between
            (case v_split when 'train' then v_train_start else v_val_start end)
            and (case v_split when 'train' then v_train_end else v_val_end end)
      ),
      fwd as (
        select
          sc.open_time, sc.close as price_t,
          c2.close as price_fwd
        from split_candles sc
        left join candles c2
          on c2.symbol = 'BTCUSDT' and c2.interval = p_interval
         and c2.open_time = sc.open_time + (v_h || ' hours')::interval
      ),
      purged_fwd as (
        select * from fwd
        where (open_time + (v_h || ' hours')::interval) < v_boundary
          and open_time <= v_boundary - (p_embargo_days || ' days')::interval
      ),
      baseline as (
        select
          round(100.0 * count(*) filter (where price_fwd > price_t) / nullif(count(*),0), 1) as pct_rose,
          count(*) as n_survive
        from purged_fwd
      ),
      raw_count as (select count(*) as n_total from fwd where price_fwd is not null),
      pattern_hits as (
        select
          pe.pattern_name, pe.direction_expected,
          count(*) as n,
          round(100.0 * count(*) filter (
            where (pe.direction_expected = 'BULLISH' and pf.price_fwd > pf.price_t)
               or (pe.direction_expected = 'BEARISH' and pf.price_fwd < pf.price_t)
          ) / nullif(count(*),0), 1) as hit_rate_pct,
          round(avg((pf.price_fwd - pf.price_t) / pf.price_t * 100), 4) as mean_forward_return_pct,
          round((percentile_cont(0.5) within group (order by (pf.price_fwd - pf.price_t) / pf.price_t * 100))::numeric, 4) as median_forward_return_pct
        from research_pattern_events pe
        join purged_fwd pf on pf.open_time = pe.candle_open_time
        where pe.interval = p_interval
        group by pe.pattern_name, pe.direction_expected
      )
      insert into research_pattern_results_purged
        (pattern_name, interval, direction_expected, split, horizon_hours, embargo_days, n, n_purged_out,
         hit_rate_pct, baseline_hit_rate_pct, edge_vs_baseline_pp, mean_forward_return_pct, median_forward_return_pct)
      select
        ph.pattern_name, p_interval, ph.direction_expected, v_split, v_h, p_embargo_days,
        ph.n,
        coalesce((select n_total from raw_count),0) - (select n_survive from baseline),
        ph.hit_rate_pct,
        case when ph.direction_expected = 'BULLISH' then (select pct_rose from baseline)
             else round(100 - (select pct_rose from baseline), 1) end,
        case when ph.direction_expected = 'BULLISH' then round(ph.hit_rate_pct - (select pct_rose from baseline), 1)
             else round(ph.hit_rate_pct - (100 - (select pct_rose from baseline)), 1) end,
        ph.mean_forward_return_pct, ph.median_forward_return_pct
      from pattern_hits ph
      on conflict (pattern_name, interval, direction_expected, split, horizon_hours) do update set
        embargo_days=excluded.embargo_days, n=excluded.n, n_purged_out=excluded.n_purged_out,
        hit_rate_pct=excluded.hit_rate_pct, baseline_hit_rate_pct=excluded.baseline_hit_rate_pct,
        edge_vs_baseline_pp=excluded.edge_vs_baseline_pp, mean_forward_return_pct=excluded.mean_forward_return_pct,
        median_forward_return_pct=excluded.median_forward_return_pct, computed_at=now();

      get diagnostics v_rc = row_count;
      v_inserted := v_inserted + v_rc;
    end loop;
  end loop;
  return v_inserted;
end;
$function$;

create or replace function public.research_bh_fdr_patterns(p_alpha numeric default 0.05)
returns table(pattern_name text, "interval" text, direction_expected text, split text, horizon_hours integer, n integer, hit_rate_pct numeric, baseline_hit_rate_pct numeric, raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean)
language sql
stable
as $function$
  with tested as (
    select
      r.pattern_name, r.interval, r.direction_expected, r.split, r.horizon_hours, r.n,
      r.hit_rate_pct, r.baseline_hit_rate_pct,
      (r.hit_rate_pct/100.0) as p_hat,
      (r.baseline_hit_rate_pct/100.0) as p0
    from research_pattern_results_purged r
    where r.n > 0 and r.hit_rate_pct is not null
  ),
  with_p as (
    select *,
      2 * (1 - public.research_norm_cdf(
        abs((p_hat - p0) / sqrt(nullif(p0*(1-p0),0)/n))
      )) as raw_p_value
    from tested
    where p0 > 0 and p0 < 1
  ),
  ranked as (
    select *, rank() over (order by raw_p_value) as rnk, count(*) over () as m
    from with_p
  )
  select
    pattern_name, interval, direction_expected, split, horizon_hours, n,
    round(hit_rate_pct,1), round(baseline_hit_rate_pct,1),
    round(raw_p_value,4), rnk::int,
    round((rnk::numeric/m)*p_alpha, 4),
    raw_p_value <= (rnk::numeric/m)*p_alpha
  from ranked
  order by raw_p_value;
$function$;

select public.research_evaluate_patterns_purged('1d', array[24,72,168], 3);
select public.research_evaluate_patterns_purged('1h', array[4,12,24], 1);
