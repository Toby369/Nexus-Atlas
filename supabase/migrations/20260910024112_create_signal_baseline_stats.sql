-- Exportiert aus supabase_migrations.schema_migrations (20260910024112 create_signal_baseline_stats)


-- Unbedingte Baseline: fuer jede 1H-Kerze (Binance BTCUSDT) im gewaehlten
-- Fenster wird die naechste bereits abgeschlossene Kerze ab genau
-- horizon_hours spaeter herangezogen -- exakt dieselbe Punkt-in-Zeit-sichere
-- Logik wie fill_signal_outcomes(), damit Signal-Ergebnis und Baseline
-- methodisch vergleichbar sind (gleiche Quelle, gleicher Horizont-
-- Mechanismus, nur ohne Signal-Bedingung).
create or replace function public.signal_baseline_stats(p_horizon_hours integer, p_window text)
returns table (
  baseline_bullish_rate numeric,
  baseline_bearish_rate numeric,
  n_pairs integer,
  avg_abs_return_pct numeric,
  stddev_abs_return_pct numeric
)
language sql
stable
set search_path = ''
as $$
  with pairs as (
    select c.close as start_price, c2.close as end_price
    from public.candles c
    cross join lateral (
      select c2.close
      from public.candles c2
      where c2.exchange = 'binance' and c2.symbol = 'BTCUSDT' and c2.interval = '1h'
        and c2.open_time >= c.open_time + (p_horizon_hours || ' hours')::interval
        and c2.close_time <= now()
      order by c2.open_time asc
      limit 1
    ) c2
    where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = '1h'
      and (p_window <> '90d' or c.open_time >= now() - interval '90 days')
  )
  select
    avg(case when end_price > start_price then 1.0 else 0.0 end),
    avg(case when end_price < start_price then 1.0 else 0.0 end),
    count(*)::integer,
    avg(abs((end_price - start_price) / start_price) * 100),
    stddev_samp(abs((end_price - start_price) / start_price) * 100)
  from pairs;
$$;

comment on function public.signal_baseline_stats is
  'Periodischer KI-Rueckblick Phase 2 (10.09.2026): unbedingte Baseline (Richtungswahrscheinlichkeit + durchschnittliche/Streuung der absoluten Preisbewegung) ueber alle 1H-Kerzen im gewaehlten Fenster, fuer denselben Horizont wie die zu bewertenden Signale. p_window: 90d = letzte 90 Tage, alles andere (z.B. all) = gesamte verfuegbare Historie.';
