-- Exportiert aus supabase_migrations.schema_migrations (20260904173713 candlestick_pattern_detection)


-- Point-in-time-safe candlestick pattern detector. Each pattern at candle t
-- uses only OHLC of candle t and earlier candles (t-1, t-2, t-5, t-6) --
-- zero lookahead. Pre-registered thresholds (fixed before any results were
-- viewed):
--   DOJI_BODY_RATIO=0.10, HAMMER_BODY_RATIO=0.30, HAMMER_DOM_WICK_RATIO=0.50,
--   HAMMER_OPP_WICK_RATIO=0.15, STAR_LONG_BODY_RATIO=0.50, STAR_SMALL_BODY_RATIO=0.30.
-- Trend context (Hammer/Hanging Man/Doji direction) uses close[t-1] vs
-- close[t-6] (5-bar trend ENDING BEFORE the pattern candle, so the pattern
-- candle's own move never contaminates its own trend classification).
-- Engulfing/Star patterns get their direction from their own shape, not
-- from external trend context (documented simplification vs. full
-- classical TA practice, which sometimes also conditions these on a prior
-- trend).
create or replace function public.research_detect_candlestick_patterns(p_interval text)
returns table(candle_open_time timestamptz, pattern_name text, direction_expected text)
language sql
stable
as $$
  with c as (
    select
      open_time,
      open, high, low, close,
      lag(open,1)  over w as o1, lag(high,1) over w as h1, lag(low,1) over w as l1, lag(close,1) over w as c1,
      lag(open,2)  over w as o2, lag(high,2) over w as h2, lag(low,2) over w as l2, lag(close,2) over w as c2,
      lag(close,1) over w as close_1back,
      lag(close,6) over w as close_6back
    from candles
    where symbol = 'BTCUSDT' and interval = p_interval
    window w as (order by open_time)
  ),
  calc as (
    select
      *,
      (high - low)              as range0,
      abs(close - open)         as body0,
      (high - greatest(open,close)) as upper_wick0,
      (least(open,close) - low)     as lower_wick0,
      (h1 - l1)                 as range1,
      abs(c1 - o1)              as body1,
      (h2 - l2)                 as range2,
      abs(c2 - o2)              as body2,
      case when close_1back < close_6back then 'down'
           when close_1back > close_6back then 'up'
           else null end        as prior_trend
    from c
  )
  -- Doji
  select open_time, 'doji', case prior_trend when 'down' then 'BULLISH' when 'up' then 'BEARISH' else null end
  from calc
  where range0 > 0 and body0 <= 0.10 * range0 and prior_trend is not null

  union all
  -- Hammer (small body, long lower wick dominates range, small upper wick, prior downtrend)
  select open_time, 'hammer', 'BULLISH'
  from calc
  where range0 > 0
    and body0 <= 0.30 * range0
    and lower_wick0 >= 2.0 * greatest(body0, 0.0001)
    and lower_wick0 >= 0.50 * range0
    and upper_wick0 <= 0.15 * range0
    and prior_trend = 'down'

  union all
  -- Hanging Man (identical shape to Hammer, but prior UPtrend -> bearish)
  select open_time, 'hanging_man', 'BEARISH'
  from calc
  where range0 > 0
    and body0 <= 0.30 * range0
    and lower_wick0 >= 2.0 * greatest(body0, 0.0001)
    and lower_wick0 >= 0.50 * range0
    and upper_wick0 <= 0.15 * range0
    and prior_trend = 'up'

  union all
  -- Bullish Engulfing: t-1 bearish, t bullish, body of t engulfs body of t-1
  select open_time, 'bullish_engulfing', 'BULLISH'
  from calc
  where body0 > 0 and body1 > 0
    and c1 < o1 and close > open
    and open <= c1 and close >= o1

  union all
  -- Bearish Engulfing: t-1 bullish, t bearish, body of t engulfs body of t-1
  select open_time, 'bearish_engulfing', 'BEARISH'
  from calc
  where body0 > 0 and body1 > 0
    and c1 > o1 and close < open
    and open >= c1 and close <= o1

  union all
  -- Morning Star: t-2 long bearish, t-1 small body (star), t long bullish closing above t-2's midpoint
  select open_time, 'morning_star', 'BULLISH'
  from calc
  where range2 > 0 and c2 < o2 and body2 >= 0.50 * range2
    and body1 <= 0.30 * range2
    and range0 > 0 and close > open and body0 >= 0.50 * range0
    and close > (o2 + c2) / 2.0

  union all
  -- Evening Star: t-2 long bullish, t-1 small body (star), t long bearish closing below t-2's midpoint
  select open_time, 'evening_star', 'BEARISH'
  from calc
  where range2 > 0 and c2 > o2 and body2 >= 0.50 * range2
    and body1 <= 0.30 * range2
    and range0 > 0 and close < open and body0 >= 0.50 * range0
    and close < (o2 + c2) / 2.0;
$$;

create table if not exists public.research_pattern_events (
  candle_open_time timestamptz not null,
  interval text not null,
  pattern_name text not null,
  direction_expected text,
  detected_at timestamptz not null default now(),
  primary key (candle_open_time, interval, pattern_name)
);
alter table public.research_pattern_events enable row level security;
create policy research_pattern_events_select_all on public.research_pattern_events for select to public using (true);

insert into public.research_pattern_events (candle_open_time, interval, pattern_name, direction_expected)
select candle_open_time, '1d', pattern_name, direction_expected
from public.research_detect_candlestick_patterns('1d')
where direction_expected is not null
on conflict do nothing;

insert into public.research_pattern_events (candle_open_time, interval, pattern_name, direction_expected)
select candle_open_time, '1h', pattern_name, direction_expected
from public.research_detect_candlestick_patterns('1h')
where direction_expected is not null
on conflict do nothing;
