-- Exportiert aus supabase_migrations.schema_migrations (20260911142157 fix_research_swing_setup_events_perf)

-- Performance-Fix: die Trailing-LATERAL wurde fuer JEDE Zeile ausgefuehrt (auch SL/TIMEOUT),
-- weil die ON-Bedingung bei LATERAL erst NACH der Subquery-Ausfuehrung greift, nicht davor.
-- Guard jetzt als erste WHERE-Bedingung in der windowed-CTE selbst -- fuer SL/TIMEOUT-Zeilen
-- bricht der Scan sofort ab, statt bis zu 192 Kerzen unnoetig zu lesen/sortieren.
create or replace function public.research_swing_setup_events(
  p_interval text,
  p_direction text,
  p_tp_pct numeric,
  p_sl_pct numeric,
  p_retrace_pct numeric,
  p_vertical_bars integer,
  p_signal_start timestamp with time zone default '-infinity'::timestamptz,
  p_signal_end timestamp with time zone default 'infinity'::timestamptz
)
returns table(
  signal_time timestamp with time zone,
  entry_time timestamp with time zone,
  entry_price numeric,
  outcome text,
  resolution_time timestamp with time zone,
  bars_to_resolution integer,
  mfe_pct numeric
)
language sql
stable
as $function$
  with bar_duration as (
    select case p_interval
      when '15m' then interval '15 minutes'
      when '1h' then interval '1 hour'
      when '4h' then interval '4 hours'
      when '1d' then interval '1 day'
    end as d
  ),
  base as (
    select
      open_time as signal_time,
      lead(open_time) over w as entry_time,
      lead(open) over w as entry_price
    from candles
    where symbol = 'BTCUSDT' and interval = p_interval
    window w as (order by open_time)
  ),
  b as (
    select * from base
    where entry_time is not null
      and signal_time >= p_signal_start and signal_time < p_signal_end
  ),
  ts as (
    select b.*,
      case when p_direction = 'LONG' then b.entry_price * (1 + p_tp_pct/100.0) else b.entry_price * (1 - p_tp_pct/100.0) end as tp_price,
      case when p_direction = 'LONG' then b.entry_price * (1 - p_sl_pct/100.0) else b.entry_price * (1 + p_sl_pct/100.0) end as sl_price
    from b
  ),
  first_touch as (
    select ts.*, touch.open_time as touch_time, touch.high as touch_high, touch.low as touch_low
    from ts
    left join lateral (
      select c.open_time, c.high, c.low
      from candles c, bar_duration
      where c.symbol = 'BTCUSDT' and c.interval = p_interval
        and c.open_time >= ts.entry_time
        and c.open_time < ts.entry_time + p_vertical_bars * bar_duration.d
        and (
          (p_direction = 'LONG' and (c.high >= ts.tp_price or c.low <= ts.sl_price))
          or
          (p_direction = 'SHORT' and (c.low <= ts.tp_price or c.high >= ts.sl_price))
        )
      order by c.open_time
      limit 1
    ) touch on true
  ),
  stage1 as (
    select *,
      case
        when touch_time is null then 'TIMEOUT'
        when p_direction = 'LONG' and touch_low <= sl_price then 'SL'
        when p_direction = 'SHORT' and touch_high >= sl_price then 'SL'
        else 'TP_TOUCHED'
      end as stage1_outcome
    from first_touch
  ),
  with_trail as (
    select st.*, trail.exit_time, trail.exit_peak, trail.is_retrace
    from stage1 st
    left join lateral (
      with windowed as (
        select c.open_time, c.high, c.low,
          max(c.high) over (order by c.open_time) as peak_high,
          min(c.low) over (order by c.open_time) as peak_low
        from candles c, bar_duration
        where st.stage1_outcome = 'TP_TOUCHED'
          and c.symbol = 'BTCUSDT' and c.interval = p_interval
          and c.open_time >= st.touch_time
          and c.open_time < st.entry_time + p_vertical_bars * bar_duration.d
      ),
      picked as (
        (
          select open_time,
            case when p_direction = 'LONG' then peak_high else peak_low end as peak,
            true as is_retrace
          from windowed
          where (p_direction = 'LONG' and low <= peak_high * (1 - p_retrace_pct/100.0))
             or (p_direction = 'SHORT' and high >= peak_low * (1 + p_retrace_pct/100.0))
          order by open_time
          limit 1
        )
        union all
        (
          select open_time,
            case when p_direction = 'LONG' then peak_high else peak_low end as peak,
            false as is_retrace
          from windowed
          order by open_time desc
          limit 1
        )
      )
      select open_time, peak, is_retrace from picked order by is_retrace desc limit 1
    ) trail(exit_time, exit_peak, is_retrace) on true
  )
  select
    signal_time, entry_time, entry_price,
    case
      when stage1_outcome in ('SL','TIMEOUT') then stage1_outcome
      when is_retrace then 'TRAIL_EXIT'
      else 'OPEN_AT_HORIZON'
    end as outcome,
    coalesce(exit_time, touch_time) as resolution_time,
    case when coalesce(exit_time, touch_time) is not null
      then round(extract(epoch from (coalesce(exit_time, touch_time) - entry_time)) / extract(epoch from (select d from bar_duration)))::int
      else null
    end as bars_to_resolution,
    case
      when stage1_outcome = 'SL' then case when p_direction='LONG' then (touch_low/entry_price - 1)*100 else (1 - touch_high/entry_price)*100 end
      when stage1_outcome = 'TIMEOUT' then null
      when exit_peak is not null then case when p_direction='LONG' then (exit_peak/entry_price - 1)*100 else (1 - exit_peak/entry_price)*100 end
      else null
    end as mfe_pct
  from with_trail;
$function$;

revoke all on function public.research_swing_setup_events(text,text,numeric,numeric,numeric,integer,timestamptz,timestamptz) from public, anon, authenticated;
