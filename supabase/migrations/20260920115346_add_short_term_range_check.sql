-- Exportiert aus supabase_migrations.schema_migrations (20260920115346 add_short_term_range_check)

-- 20.09.2026: Kurzfristiger Seitwaerts-Check auf 15m (Nutzer-Beobachtung:
-- "aktuelle Phase ist seitwaerts, muss so abgebildet werden, z.B. seitwaerts
-- auf kleinem TF"). Die bestehende Regime-Engine (classify_market_regime /
-- compute_market_state_matrix_series) laeuft ausschliesslich auf 1h-Bars
-- (verifiziert: alle 35.458 market_state_matrix-Zeilen sind interval='1h')
-- und nutzt fuer Trendstaerke/-richtung Fenster von 14-50 Bars (=14-50h) --
-- nach einem abgeschlossenen Trendimpuls "erinnert" sich ADX/Regressions-
-- steigung noch mehrere Stunden an die vorherige Bewegung, waehrend der
-- Kurs bereits seitwaerts laeuft (konkretes Beispiel: 20.09.2026 09:00 UTC,
-- ADX_14=36 "Trendausweitung baerisch", obwohl die letzten 9h nur 0,29%
-- Spanne hatten).
--
-- Bewusst KEINE zweite volle 5-Regime-Klassifikation auf 15m (das wuerde
-- lediglich zeitlich gestauchte 5h/12,5h-Fenster liefern, nicht das
-- gezielt kurze 16-Bar/4h-Fenster). Stattdessen ein schlanker, einzelner
-- Read (keine Historie/kein Cron/keine neue Tabelle): Bollinger-Bandwidth
-- ueber die letzten p_lookback_bars 15m-Kerzen (gleiche Formel wie in
-- compute_market_state_matrix_series, nur mit 16 statt 20 Bars) + aktueller
-- adx_14 aus market_features (interval=15m, bereits vorhanden, keine
-- Neuberechnung) -- klassifiziert mit denselben Schwellen wie
-- VOLA_SQUEEZE_RANGING (adx<20, bandwidth<=0.05), um keine neue,
-- unabgestimmte Schwelle einzufuehren.
create or replace function public.get_short_term_range_check(
  p_exchange text default 'binance',
  p_symbol text default 'BTCUSDT',
  p_lookback_bars int default 16
)
returns table (
  as_of timestamptz,
  "interval" text,
  lookback_bars int,
  adx_14 numeric,
  bb_width numeric,
  is_ranging boolean
)
language sql
stable
as $$
  with recent as (
    select open_time, close
    from candles
    where exchange = p_exchange and symbol = p_symbol and interval = '15m'
    order by open_time desc
    limit p_lookback_bars
  ),
  stats as (
    select
      max(open_time) as as_of,
      count(*) as n,
      case when avg(close) <> 0 then (4 * stddev_pop(close)) / avg(close) end as bb_width_raw
    from recent
  ),
  latest_adx as (
    select adx_14::numeric as adx_14
    from market_features
    where symbol = p_symbol and interval = '15m'
    order by candle_open_time desc
    limit 1
  )
  select
    stats.as_of,
    '15m'::text as "interval",
    p_lookback_bars as lookback_bars,
    latest_adx.adx_14,
    case when stats.n = p_lookback_bars then stats.bb_width_raw end as bb_width,
    (
      stats.n = p_lookback_bars
      and latest_adx.adx_14 is not null
      and stats.bb_width_raw is not null
      and latest_adx.adx_14 < 20
      and stats.bb_width_raw <= 0.05
    ) as is_ranging
  from stats, latest_adx;
$$;

grant execute on function public.get_short_term_range_check(text, text, int) to anon, authenticated;
