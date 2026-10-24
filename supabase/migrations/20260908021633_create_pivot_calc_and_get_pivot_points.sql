-- Exportiert aus supabase_migrations.schema_migrations (20260908021633 create_pivot_calc_and_get_pivot_points)

-- Trade-Debate-Kachel (07.09.2026): klassische Floor-Trader-Pivots
-- (PP/R1-3/S1-3), Formel bestaetigt branchenueblich (siehe Recherche
-- 07.09.2026). pivot_calc() ist bewusst eine eigene, reine Hilfsfunktion --
-- wird fuer daily/weekly/monthly identisch wiederverwendet statt dreifach
-- dupliziert.
create or replace function public.pivot_calc(h double precision, l double precision, c double precision)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'pp', (h + l + c) / 3.0,
    'r1', 2.0 * ((h + l + c) / 3.0) - l,
    'r2', ((h + l + c) / 3.0) + (h - l),
    'r3', h + 2.0 * (((h + l + c) / 3.0) - l),
    's1', 2.0 * ((h + l + c) / 3.0) - h,
    's2', ((h + l + c) / 3.0) - (h - l),
    's3', l - 2.0 * (h - ((h + l + c) / 3.0))
  );
$$;

-- get_pivot_points(): Daily-Pivots aus der letzten geschlossenen Tageskerze,
-- Weekly/Monthly aus der letzten VOLLSTAENDIG abgeschlossenen Kalenderwoche/
-- -monat (aggregiert aus den Tageskerzen in candles, exchange=binance,
-- symbol=BTCUSDT) -- reine Rohdaten-RPC, keine Interpretation (Konfluenz-
-- Pruefung mehrerer Zeitebenen passiert im Kontext-Builder, nicht hier).
create or replace function public.get_pivot_points()
returns jsonb
language sql
stable
set search_path = public
as $$
  with daily as (
    select high, low, close, open_time
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1d'
    order by open_time desc
    limit 1
  ),
  weekly_agg as (
    select
      date_trunc('week', open_time) as period_start,
      max(high) as high,
      min(low) as low,
      (array_agg(close order by open_time desc))[1] as close,
      max(open_time) as last_open_time
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1d'
    group by date_trunc('week', open_time)
  ),
  weekly as (
    select high, low, close, period_start
    from weekly_agg
    where period_start < date_trunc('week', now() at time zone 'utc')
    order by period_start desc
    limit 1
  ),
  monthly_agg as (
    select
      date_trunc('month', open_time) as period_start,
      max(high) as high,
      min(low) as low,
      (array_agg(close order by open_time desc))[1] as close
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1d'
    group by date_trunc('month', open_time)
  ),
  monthly as (
    select high, low, close, period_start
    from monthly_agg
    where period_start < date_trunc('month', now() at time zone 'utc')
    order by period_start desc
    limit 1
  )
  select jsonb_build_object(
    'daily', (
      select pivot_calc(high, low, close) || jsonb_build_object('based_on_close_utc', open_time)
      from daily
    ),
    'weekly', (
      select pivot_calc(high, low, close) || jsonb_build_object('based_on_week_start_utc', period_start)
      from weekly
    ),
    'monthly', (
      select pivot_calc(high, low, close) || jsonb_build_object('based_on_month_start_utc', period_start)
      from monthly
    )
  );
$$;
