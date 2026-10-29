-- Exportiert aus supabase_migrations.schema_migrations (20260910021053 fix_detect_functions_conflict_target)


create or replace function public.detect_tradingview_signal_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'tradingview_alert',
    tv.signal_type,
    public.tv_infer_signal_direction(tv.signal_type),
    tv.received_at,
    (tv.payload->>'price')::numeric,
    h.horizon_hours,
    'tradingview_signals',
    tv.id::text
  from public.tradingview_signals tv
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  where public.tv_infer_signal_direction(tv.signal_type) is not null
    and tv.payload->>'price' is not null
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.detect_warning_pattern_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with pattern_defs (pattern_name, direction_expected) as (
    values
      ('Fragile Bullish', 'bullish'),
      ('Distribution Warning', 'bearish'),
      ('Capitulation', 'bullish'),
      ('Short Squeeze', 'bullish')
  ),
  state_rows as (
    select
      ms.id,
      ms.created_at,
      coalesce(
        (select jsonb_agg(elem->>'name') from jsonb_array_elements(ms.patterns) elem),
        '[]'::jsonb
      ) as pattern_name_list,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price
    from public.market_states ms
  ),
  transitions as (
    select
      sr.id, sr.created_at, sr.close_price, pd.pattern_name, pd.direction_expected,
      (sr.pattern_name_list ? pd.pattern_name) as active_now,
      lag(sr.pattern_name_list ? pd.pattern_name) over (partition by pd.pattern_name order by sr.id) as active_prev
    from state_rows sr
    cross join pattern_defs pd
  ),
  fired as (
    select * from transitions
    where active_now and not coalesce(active_prev, false) and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'warning_pattern',
    f.pattern_name,
    f.direction_expected,
    f.created_at,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.detect_risk_factor_outcomes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  with state_rows as (
    select
      ms.id,
      ms.created_at,
      coalesce(ms.risk_factors, '[]'::jsonb) as risk_factor_list,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price,
      (ms.factors->'funding'->'basis'->>'avg_current_rate')::numeric as funding_rate,
      (ms.factors->'basis'->'basis'->>'basis_pct')::numeric as basis_pct
    from public.market_states ms
  ),
  factor_defs (factor_name) as (
    values ('warning_pattern'), ('low_mtf_alignment'), ('elevated_volatility'),
           ('funding_crowding'), ('basis_crowding')
  ),
  transitions as (
    select
      sr.id, sr.created_at, sr.close_price, fd.factor_name,
      case fd.factor_name
        when 'funding_crowding' then
          case when sr.funding_rate > 0 then 'bearish' when sr.funding_rate < 0 then 'bullish' else null end
        when 'basis_crowding' then
          case when sr.basis_pct > 0 then 'bearish' when sr.basis_pct < 0 then 'bullish' else null end
        else null
      end as direction_expected,
      (sr.risk_factor_list ? fd.factor_name) as active_now,
      lag(sr.risk_factor_list ? fd.factor_name) over (partition by fd.factor_name order by sr.id) as active_prev
    from state_rows sr
    cross join factor_defs fd
  ),
  fired as (
    select * from transitions
    where active_now and not coalesce(active_prev, false) and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'risk_factor',
    f.factor_name,
    f.direction_expected,
    f.created_at,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
