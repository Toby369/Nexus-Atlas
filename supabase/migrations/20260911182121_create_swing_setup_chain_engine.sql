-- Exportiert aus supabase_migrations.schema_migrations (20260911182121 create_swing_setup_chain_engine)

create table research_swing_setup_chain_results (
  id bigint generated always as identity primary key,
  interval text not null,
  direction text not null check (direction in ('LONG','SHORT')),
  tp_pct numeric not null,
  sl_pct numeric not null,
  retrace_pct numeric not null,
  vertical_bars integer not null,
  signal_time timestamptz not null,
  entry_time timestamptz not null,
  entry_price numeric not null,
  outcome text not null check (outcome in ('SL','TIMEOUT','TRAIL_EXIT','OPEN_AT_HORIZON')),
  resolution_time timestamptz not null,
  bars_to_resolution integer,
  mfe_pct numeric,
  created_at timestamptz not null default now(),
  unique (interval, direction, tp_pct, sl_pct, retrace_pct, vertical_bars, signal_time)
);

comment on table research_swing_setup_chain_results is
  'Sequenzielle, nicht-ueberlappende Swing-Setup-Kette gemaess CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md Abschnitt 1: pro Richtung hoechstens ein aktives Setup gleichzeitig, naechste Kerze nach jedem Setup-Ende ist neuer potenzieller Entry. Im Unterschied zu research_swing_setup_results (jede Kerze parallel getestet) ist dies die Ereignisquelle fuer das Confluence-Score-Protokoll.';

create or replace function research_swing_setup_chain_events(
  p_interval text,
  p_direction text,
  p_tp_pct numeric,
  p_sl_pct numeric,
  p_retrace_pct numeric,
  p_vertical_bars integer,
  p_start timestamptz,
  p_end timestamptz
) returns table (
  signal_time timestamptz,
  entry_time timestamptz,
  entry_price numeric,
  outcome text,
  resolution_time timestamptz,
  bars_to_resolution integer,
  mfe_pct numeric
) language plpgsql as $$
declare
  bar_duration interval;
  cur_time timestamptz := p_start;
  tp_price numeric;
  sl_price numeric;
  touch_time timestamptz;
  touch_high numeric;
  touch_low numeric;
  exit_time timestamptz;
  exit_peak numeric;
  is_retrace boolean;
  window_end timestamptz;
begin
  bar_duration := case p_interval
    when '15m' then interval '15 minutes'
    when '1h' then interval '1 hour'
    when '4h' then interval '4 hours'
    when '1d' then interval '1 day'
  end;

  loop
    -- naechste verfuegbare Kerze bei/nach cur_time wird zur Signal-Kerze
    select c.open_time into signal_time
    from candles c
    where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = p_interval
      and c.open_time >= cur_time and c.open_time < p_end
    order by c.open_time limit 1;

    exit when signal_time is null;

    select c.open_time, c.open into entry_time, entry_price
    from candles c
    where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = p_interval
      and c.open_time > signal_time and c.open_time < p_end
    order by c.open_time limit 1;

    exit when entry_time is null;

    tp_price := case when p_direction = 'LONG' then entry_price * (1 + p_tp_pct/100.0) else entry_price * (1 - p_tp_pct/100.0) end;
    sl_price := case when p_direction = 'LONG' then entry_price * (1 - p_sl_pct/100.0) else entry_price * (1 + p_sl_pct/100.0) end;
    window_end := entry_time + p_vertical_bars * bar_duration;

    select c.open_time, c.high, c.low into touch_time, touch_high, touch_low
    from candles c
    where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = p_interval
      and c.open_time >= entry_time and c.open_time < window_end
      and (
        (p_direction = 'LONG' and (c.high >= tp_price or c.low <= sl_price))
        or
        (p_direction = 'SHORT' and (c.low <= tp_price or c.high >= sl_price))
      )
    order by c.open_time limit 1;

    if touch_time is null then
      outcome := 'TIMEOUT';
      resolution_time := window_end;
      bars_to_resolution := p_vertical_bars;
      mfe_pct := null;
    elsif (p_direction = 'LONG' and touch_low <= sl_price) or (p_direction = 'SHORT' and touch_high >= sl_price) then
      outcome := 'SL';
      resolution_time := touch_time;
      bars_to_resolution := round(extract(epoch from (touch_time - entry_time)) / extract(epoch from bar_duration))::int;
      mfe_pct := case when p_direction = 'LONG' then (touch_low/entry_price - 1)*100 else (1 - touch_high/entry_price)*100 end;
    else
      with windowed as (
        select c.open_time, c.high, c.low,
          max(c.high) over (order by c.open_time) as peak_high,
          min(c.low) over (order by c.open_time) as peak_low
        from candles c
        where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = p_interval
          and c.open_time >= touch_time and c.open_time < window_end
      ),
      picked as (
        (
          select open_time, case when p_direction = 'LONG' then peak_high else peak_low end as peak, true as is_retrace
          from windowed
          where (p_direction = 'LONG' and low <= peak_high * (1 - p_retrace_pct/100.0))
             or (p_direction = 'SHORT' and high >= peak_low * (1 + p_retrace_pct/100.0))
          order by open_time limit 1
        )
        union all
        (
          select open_time, case when p_direction = 'LONG' then peak_high else peak_low end as peak, false as is_retrace
          from windowed
          order by open_time desc limit 1
        )
      )
      select p.open_time, p.peak, p.is_retrace into exit_time, exit_peak, is_retrace
      from picked p order by p.is_retrace desc limit 1;

      outcome := case when is_retrace then 'TRAIL_EXIT' else 'OPEN_AT_HORIZON' end;
      resolution_time := exit_time;
      bars_to_resolution := round(extract(epoch from (exit_time - entry_time)) / extract(epoch from bar_duration))::int;
      mfe_pct := case when p_direction = 'LONG' then (exit_peak/entry_price - 1)*100 else (1 - exit_peak/entry_price)*100 end;
    end if;

    return next;

    cur_time := resolution_time + bar_duration;
  end loop;
end;
$$;
