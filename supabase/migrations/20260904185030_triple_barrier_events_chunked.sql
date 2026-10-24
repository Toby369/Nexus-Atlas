-- Exportiert aus supabase_migrations.schema_migrations (20260904185030 triple_barrier_events_chunked)


create or replace function public.research_triple_barrier_events(
  p_interval text,
  p_direction text,
  p_tp_pct numeric,
  p_sl_pct numeric,
  p_vertical_bars integer,
  p_signal_start timestamptz default '-infinity',
  p_signal_end timestamptz default 'infinity'
)
returns table(
  signal_time timestamptz,
  entry_time timestamptz,
  entry_price numeric,
  outcome text,
  resolution_time timestamptz,
  bars_to_resolution integer
)
language sql
stable
as $$
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
      and open_time >= p_signal_start - interval '1 day'
      and open_time < p_signal_end
    window w as (order by open_time)
  ),
  b as (
    select * from base
    where entry_time is not null
      and signal_time >= p_signal_start and signal_time < p_signal_end
  ),
  ts AS (
    select
      b.*,
      case when p_direction = 'LONG' then b.entry_price * (1 + p_tp_pct/100.0) else b.entry_price * (1 - p_tp_pct/100.0) end as tp_price,
      case when p_direction = 'LONG' then b.entry_price * (1 - p_sl_pct/100.0) else b.entry_price * (1 + p_sl_pct/100.0) end as sl_price
    from b
  )
  select
    ts.signal_time, ts.entry_time, ts.entry_price,
    coalesce(
      case
        when p_direction = 'LONG' and touch.low <= ts.sl_price then 'SL'
        when p_direction = 'LONG' and touch.high >= ts.tp_price then 'TP'
        when p_direction = 'SHORT' and touch.high >= ts.sl_price then 'SL'
        when p_direction = 'SHORT' and touch.low <= ts.tp_price then 'TP'
      end,
      'TIMEOUT'
    ) as outcome,
    touch.open_time as resolution_time,
    case when touch.open_time is not null
      then round(extract(epoch from (touch.open_time - ts.entry_time)) / extract(epoch from (select d from bar_duration)))::int
      else null
    end as bars_to_resolution
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
  ) touch on true;
$$;
