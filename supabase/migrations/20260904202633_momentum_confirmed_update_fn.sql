-- Exportiert aus supabase_migrations.schema_migrations (20260904202633 momentum_confirmed_update_fn)


create or replace function public.research_update_momentum_confirmed(
  p_signal_start timestamptz, p_signal_end timestamptz
)
returns integer
language sql
as $$
  with target as (
    select signal_time, direction
    from public.research_triple_barrier_context
    where signal_time >= p_signal_start and signal_time < p_signal_end
  ),
  withmacd as (
    select t.signal_time, t.direction, h.macd_histogram
    from target t
    left join lateral (
      select macd_histogram from market_features
      where symbol='BTCUSDT' and interval='1h'
        and candle_open_time <= t.signal_time - interval '1 hour'
      order by candle_open_time desc
      limit 1
    ) h on true
  ),
  upd as (
    update public.research_triple_barrier_context c
    set momentum_confirmed_1h = case
      when w.macd_histogram is null then null
      when c.direction = 'LONG' then w.macd_histogram > 0
      else w.macd_histogram < 0
    end
    from withmacd w
    where c.signal_time = w.signal_time and c.direction = w.direction
      and c.signal_time >= p_signal_start and c.signal_time < p_signal_end
    returning 1
  )
  select count(*) from upd;
$$;
