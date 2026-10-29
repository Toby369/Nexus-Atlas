-- Exportiert aus supabase_migrations.schema_migrations (20260908022155 create_get_anchored_vwap_summary)

-- Trade-Debate-Kachel (07.09.2026): Weekly/Monthly/Swing-VWAP -- alle
-- kumulativ ab einem Ankerpunkt bis jetzt, aus 1h-Kerzen (feinste Aufloesung
-- mit voller Historie). Ergaenzt bewusst den bestehenden rollierenden
-- 20-Perioden-VWAP in market_features (siehe dortiger Kommentar zur
-- "kein Session-Reset"-Entscheidung) -- Weekly/Monthly/Anchored-VWAP sind
-- ein eigenstaendiges, institutionell etabliertes Konzept (siehe Recherche
-- 07.09.2026), kein Widerspruch dazu.
create or replace function public.get_anchored_vwap_summary()
returns jsonb
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('week', now() at time zone 'utc') as week_start,
      date_trunc('month', now() at time zone 'utc') as month_start
  ),
  -- Anker fuer Swing-VWAP: die juengste bestaetigte Swing-Kerze (HH/HL/LH/LL)
  -- auf 1h -- wiederverwendet die bestehende fraktale Swing-Erkennung aus
  -- collect-candles statt einer zweiten, abweichenden Definition.
  swing_anchor as (
    select candle_open_time, swing_type
    from market_features
    where symbol = 'BTCUSDT' and interval = '1h' and swing_type is not null
    order by candle_open_time desc
    limit 1
  ),
  weekly_candles as (
    select high, low, close, volume
    from candles, bounds
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
      and open_time >= bounds.week_start
  ),
  monthly_candles as (
    select high, low, close, volume
    from candles, bounds
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
      and open_time >= bounds.month_start
  ),
  swing_candles as (
    select c.high, c.low, c.close, c.volume
    from candles c, swing_anchor
    where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = '1h'
      and c.open_time >= swing_anchor.candle_open_time
  ),
  latest_price as (
    select close
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
    order by open_time desc
    limit 1
  )
  select jsonb_build_object(
    'current_price', (select close from latest_price),
    'weekly_vwap', (
      select sum((high + low + close) / 3.0 * volume) / nullif(sum(volume), 0)
      from weekly_candles
    ),
    'weekly_anchor_utc', (select week_start from bounds),
    'monthly_vwap', (
      select sum((high + low + close) / 3.0 * volume) / nullif(sum(volume), 0)
      from monthly_candles
    ),
    'monthly_anchor_utc', (select month_start from bounds),
    'swing_vwap', (
      select sum((high + low + close) / 3.0 * volume) / nullif(sum(volume), 0)
      from swing_candles
    ),
    'swing_anchor_utc', (select candle_open_time from swing_anchor),
    'swing_anchor_type', (select swing_type from swing_anchor)
  );
$$;
