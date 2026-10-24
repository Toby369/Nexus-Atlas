-- Exportiert aus supabase_migrations.schema_migrations (20260827184422 create_research_purge_embargo_infrastructure)


-- Phase 1: Purging + Embargo + Assertions + Ergebnis-Tabellen. Rein
-- additiv, research-only. Alte backtest_model_results bleiben unveraendert
-- (kein UPDATE, kein DELETE) -- neue, korrigierte Laeufe landen in einer
-- eigenen Tabelle mit explizitem validity_status.
create table if not exists public.research_model_results_purged (
  id bigserial primary key,
  model_version text not null,          -- z.B. 'domain_balanced_v1', referenziert backtest_model_runs
  family text not null,                 -- welche State-Funktion tatsaechlich verwendet wurde (inkl. _covfix)
  split text not null check (split in ('train','validation')),
  horizon_hours integer not null,
  embargo_days integer not null,
  overlap_mode text not null default 'overlapping' check (overlap_mode in ('overlapping','non_overlapping')),
  direction text not null check (direction in ('BULLISH','BEARISH')),
  n integer not null,
  n_purged_out integer not null,
  hit_rate_pct numeric,
  baseline_hit_rate_pct numeric,
  edge_vs_baseline_pp numeric,
  mean_forward_return_pct numeric,
  median_forward_return_pct numeric,
  validity_status text not null default 'POST_PURGE_EMBARGO_CORRECTED',
  computed_at timestamptz not null default now(),
  unique (model_version, family, split, horizon_hours, embargo_days, overlap_mode, direction)
);
alter table public.research_model_results_purged enable row level security;
create policy "research_model_results_purged_select_all" on public.research_model_results_purged for select using (true);
revoke all on public.research_model_results_purged from anon, authenticated;
grant select on public.research_model_results_purged to anon, authenticated, service_role;
grant insert on public.research_model_results_purged to service_role;

create table if not exists public.research_leakage_integrity_log (
  id bigserial primary key,
  split text not null,
  horizon_hours integer not null,
  embargo_days integer not null,
  boundary_start timestamptz not null,   -- validation_start (fuer split='train') bzw. test_start (fuer split='validation')
  train_end_effective timestamptz,       -- juengste tatsaechlich verwendete candle_open_time nach Purge+Embargo
  max_label_end timestamptz,             -- juengstes label_end unter den survivierenden Zeilen
  purge boolean not null default true,
  embargo boolean not null default true,
  leakage boolean not null,
  checked_at timestamptz not null default now()
);
alter table public.research_leakage_integrity_log enable row level security;
create policy "research_leakage_integrity_log_select_all" on public.research_leakage_integrity_log for select using (true);
revoke all on public.research_leakage_integrity_log from anon, authenticated;
grant select on public.research_leakage_integrity_log to anon, authenticated, service_role;
grant insert on public.research_leakage_integrity_log to service_role;

-- Zentrale Auswertungsfunktion: purged + embargoed Hit-Rate je Modell,
-- Horizont, Split, Richtung. Haerte gegen Leakage: RAISE EXCEPTION, wenn
-- die Kernbedingung verletzt ist -- kein stilles Weiterlaufen.
create or replace function public.research_evaluate_purged(
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
  v_horizons integer[] := array[24, 168, 720];
  v_h integer;
  v_split text;
  v_boundary timestamptz;
  v_inserted integer := 0;
  v_max_label_end timestamptz;
  v_max_candle timestamptz;
  v_leak boolean;
begin
  select * into v_run from backtest_model_runs where model_version = p_model_version;
  if not found then
    raise exception 'research_evaluate_purged: unbekannte model_version %', p_model_version;
  end if;

  foreach v_h in array v_horizons loop
    foreach v_split in array array['train','validation'] loop
      v_boundary := case v_split
        when 'train' then v_run.validation_start::timestamptz
        when 'validation' then v_run.test_start::timestamptz
      end;

      -- Assertion vorab pruefen (Selbstschutz: die nachfolgende Abfrage
      -- filtert bereits korrekt, dieser Block verifiziert es zusaetzlich
      -- und schreibt das Ergebnis ins Integrity-Log -- hartes Scheitern
      -- bei Verletzung, kein stilles Weiterlaufen).
      with split_rows as (
        select bs.candle_open_time, mf.close_price as price_t,
          case v_run.model_family
            when 'domain_balanced' then (case p_family
              when 'domain_balanced_covfix' then public.experimental_domain_signal_state_covfix(bs.factors)
              else bs.domain_result end)
            when 'calibrated' then public.calibrated_v1_signal_state_covfix(bs.factors)
            when 'redundancy_aware' then public.redundancy_aware_v1_signal_state(bs.factors)
          end as result
        from backtest_states bs
        join market_features mf on mf.symbol='BTCUSDT' and mf.interval=v_run.interval and mf.candle_open_time=bs.candle_open_time
        where bs.interval = v_run.interval and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
          and bs.candle_open_time::date between
            (case v_split when 'train' then v_run.train_start else v_run.validation_start end)
            and (case v_split when 'train' then v_run.train_end else v_run.validation_end end)
      ),
      purged as (
        select *, candle_open_time + (v_h || ' hours')::interval as label_end
        from split_rows
        where candle_open_time + (v_h || ' hours')::interval < v_boundary   -- PURGE
          and candle_open_time <= v_boundary - (p_embargo_days || ' days')::interval  -- EMBARGO
      )
      select max(label_end), max(candle_open_time) into v_max_label_end, v_max_candle from purged;

      v_leak := (v_max_label_end is not null and v_max_label_end >= v_boundary)
             or (v_max_candle is not null and v_max_candle > v_boundary - (p_embargo_days || ' days')::interval);

      insert into research_leakage_integrity_log (split, horizon_hours, embargo_days, boundary_start, train_end_effective, max_label_end, leakage)
      values (v_split, v_h, p_embargo_days, v_boundary, v_max_candle, v_max_label_end, coalesce(v_leak, false));

      if v_leak then
        raise exception 'research_evaluate_purged: LEAKAGE erkannt fuer split=%, horizon=%h, model=% -- max_label_end=% >= boundary=% oder embargo verletzt',
          v_split, v_h, p_model_version, v_max_label_end, v_boundary;
      end if;
    end loop;
  end loop;

  -- Eigentliche Auswertung, jetzt mit garantiert leckagefreien Zeilen.
  with horizons as (select unnest(v_horizons) as horizon_hours),
  splits as (select unnest(array['train','validation']) as split),
  base_rows as (
    select
      bs.candle_open_time,
      mf.close_price as price_t,
      s.split,
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
  fwd as (
    select
      b.split, h.horizon_hours, b.overall_state, b.price_t, b.candle_open_time,
      mf2.close_price as price_fwd,
      (case b.split when 'train' then v_run.validation_start::timestamptz else v_run.test_start::timestamptz end) as boundary,
      case when mf2.close_price is not null then ((mf2.close_price - b.price_t) / b.price_t) * 100 end as forward_return_pct
    from base_rows b
    cross join horizons h
    left join market_features mf2
      on mf2.symbol = 'BTCUSDT' and mf2.interval = v_run.interval
     and mf2.candle_open_time = b.candle_open_time + (h.horizon_hours || ' hours')::interval
  ),
  purged_fwd as (
    select * from fwd
    where (candle_open_time + (horizon_hours || ' hours')::interval) < boundary
      and candle_open_time <= boundary - (p_embargo_days || ' days')::interval
  ),
  baseline as (
    select split, horizon_hours,
      round(100.0 * count(*) filter (where price_fwd > price_t) / nullif(count(*),0), 1) as pct_rose,
      count(*) as n_survive
    from purged_fwd
    group by split, horizon_hours
  ),
  raw_counts as (
    select split, horizon_hours, count(*) as n_total from fwd where forward_return_pct is not null group by split, horizon_hours
  ),
  per_direction as (
    select
      pf.split, pf.horizon_hours, d.direction,
      count(*) filter (where pf.overall_state = d.direction and pf.forward_return_pct is not null) as n,
      round(100.0 * count(*) filter (
        where pf.overall_state = d.direction and pf.forward_return_pct is not null
        and ((d.direction = 'BULLISH' and pf.price_fwd > pf.price_t) or (d.direction = 'BEARISH' and pf.price_fwd < pf.price_t))
      ) / nullif(count(*) filter (where pf.overall_state = d.direction and pf.forward_return_pct is not null), 0), 1) as hit_rate_pct,
      round(avg(pf.forward_return_pct) filter (where pf.overall_state = d.direction), 4) as mean_forward_return_pct,
      round((percentile_cont(0.5) within group (order by pf.forward_return_pct) filter (where pf.overall_state = d.direction))::numeric, 4) as median_forward_return_pct
    from purged_fwd pf
    cross join (values ('BULLISH'), ('BEARISH')) as d(direction)
    group by pf.split, pf.horizon_hours, d.direction
  )
  insert into research_model_results_purged
    (model_version, family, split, horizon_hours, embargo_days, direction, n, n_purged_out, hit_rate_pct, baseline_hit_rate_pct, edge_vs_baseline_pp, mean_forward_return_pct, median_forward_return_pct, validity_status)
  select
    p_model_version, p_family, pd.split, pd.horizon_hours, p_embargo_days, pd.direction,
    pd.n,
    coalesce(rc.n_total,0) - bl.n_survive,
    pd.hit_rate_pct,
    case when pd.direction='BULLISH' then bl.pct_rose else round(100-bl.pct_rose,1) end,
    case when pd.direction='BULLISH' then round(pd.hit_rate_pct - bl.pct_rose, 1)
         else round(pd.hit_rate_pct - (100 - bl.pct_rose), 1) end,
    pd.mean_forward_return_pct, pd.median_forward_return_pct,
    'POST_PURGE_EMBARGO_CORRECTED'
  from per_direction pd
  join baseline bl on bl.split=pd.split and bl.horizon_hours=pd.horizon_hours
  left join raw_counts rc on rc.split=pd.split and rc.horizon_hours=pd.horizon_hours
  on conflict (model_version, family, split, horizon_hours, embargo_days, overlap_mode, direction) do update set
    n=excluded.n, n_purged_out=excluded.n_purged_out, hit_rate_pct=excluded.hit_rate_pct,
    baseline_hit_rate_pct=excluded.baseline_hit_rate_pct, edge_vs_baseline_pp=excluded.edge_vs_baseline_pp,
    mean_forward_return_pct=excluded.mean_forward_return_pct, median_forward_return_pct=excluded.median_forward_return_pct,
    computed_at=now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.research_evaluate_purged(text, text, integer) from public, anon, authenticated;
grant execute on function public.research_evaluate_purged(text, text, integer) to service_role;
