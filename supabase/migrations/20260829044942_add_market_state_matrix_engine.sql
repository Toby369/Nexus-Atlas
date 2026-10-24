-- Exportiert aus supabase_migrations.schema_migrations (20260829044942 add_market_state_matrix_engine)

-- Phase 3: Market State Matrix Engine.
--
-- Neue, additive Tabelle + SQL-Funktionen fuer die 5 Feature-Engine-Saeulen
-- und die Regime-Klassifizierung (Live-Pipeline-Gegenstueck zu
-- research-python/src/features/{trend,volatility,mean_reversion,
-- derivatives,sentiment}.py + research-python/src/regime.py -- identische
-- Formeln/Schwellenwerte, damit Research- und Live-Ergebnisse uebereinstimmen).
--
-- Bewusst NICHT in collect-candles/compute-market-state integriert (beide
-- sind live, planmaessig laufende Produktions-Funktionen, die das gesamte
-- Dashboard versorgen) -- diese Migration ist rein additiv (neue Tabelle,
-- neue Funktionen), aendert keine bestehende Tabelle/Funktion/Edge Function.

create table public.market_state_matrix (
  id bigint generated always as identity primary key,
  timestamp_utc timestamptz not null,
  symbol text not null default 'BTCUSDT',
  interval text not null default '1h',

  -- Saeule 1: Trend
  adx_14 numeric,
  plus_di numeric,
  minus_di numeric,
  linreg_slope numeric,
  linreg_r2 numeric,

  -- Saeule 2: Volatilitaet
  garman_klass_vol numeric,
  bb_width numeric,
  bb_percent_b numeric,
  atr_ratio numeric,

  -- Saeule 3: Momentum/Mean-Reversion
  rsi_14 numeric,
  dist_zscore_sma20 numeric,
  dist_zscore_sma50 numeric,
  dist_zscore_sma200 numeric,

  -- Saeule 4: Mikrostruktur & Derivate
  funding_zscore numeric,
  price_change_pct numeric,
  oi_change_pct numeric,
  oi_price_quadrant text,
  cvd_zscore numeric,

  -- Saeule 5: Makro/Sentiment
  liq_cluster_density numeric,
  net_taker_flow_ratio numeric,

  -- Regime Matrix Engine Output
  regime text not null,
  data_coverage_pct numeric,

  created_at timestamptz not null default now(),
  unique (timestamp_utc, symbol, interval)
);

create index idx_market_state_matrix_timestamp on public.market_state_matrix (timestamp_utc desc);
create index idx_market_state_matrix_regime on public.market_state_matrix (regime);

alter table public.market_state_matrix enable row level security;
create policy "Public read access" on public.market_state_matrix for select using (true);


-- Reines, zustandsloses Klassifizierungs-Funktion -- exaktes SQL-Gegenstueck
-- zu research-python/src/regime.py::classify_market_regime (selbe
-- Prioritaetsreihenfolge, dieselben Default-Schwellenwerte aus
-- RegimeThresholds()). Ein fehlender/NULL-Eingabewert klassifiziert immer
-- als UNRESOLVED_NEUTRAL, nie als eine der positiven Regimes.
create or replace function public.classify_market_regime(
  p_adx numeric,
  p_plus_di numeric,
  p_minus_di numeric,
  p_slope numeric,
  p_bandwidth numeric,
  p_atr_ratio numeric,
  p_dist_zscore_sma50 numeric
) returns text
language sql
immutable
as $$
  select case
    when p_adx is null or p_plus_di is null or p_minus_di is null or p_slope is null
      or p_bandwidth is null or p_atr_ratio is null or p_dist_zscore_sma50 is null
      then 'UNRESOLVED_NEUTRAL'
    when p_atr_ratio > 1.5 and abs(p_dist_zscore_sma50) > 2.0
      then 'HIGH_VOLA_REVERSION'
    when p_adx >= 25 and p_plus_di > p_minus_di and p_slope > 0
      then 'TREND_EXPANSION_BULLISH'
    when p_adx >= 25 and p_minus_di > p_plus_di and p_slope < 0
      then 'TREND_EXPANSION_BEARISH'
    when p_adx < 20 and p_bandwidth <= 0.05
      then 'VOLA_SQUEEZE_RANGING'
    else 'UNRESOLVED_NEUTRAL'
  end;
$$;


-- Berechnet die vollstaendige historische Zeitreihe aller 5 Saeulen +
-- Regime fuer (p_symbol, p_interval, p_exchange). Kausal durchgehend:
-- jede Fenster-/Lag-Funktion schaut ausschliesslich rueckwaerts (ROWS
-- BETWEEN n PRECEDING AND CURRENT ROW bzw. LAG()), nie nach vorne.
--
-- Zeitraster: die Candles-Tabelle (OHLCV, exakt eine Boerse/exakt ein
-- Intervall) ist das kanonische Raster -- Funding (Bybit, Referenz-Boerse
-- des Dashboards), Open Interest, Liquidationen und Taker-Flow werden alle
-- auf dasselbe Stunden-Raster aggregiert (letzter Wert je Stunde bzw.
-- Summe je Stunde), damit alle Saeulen zu jedem Zeitpunkt exakt
-- vergleichbar sind.
create or replace function public.compute_market_state_matrix_series(
  p_symbol text default 'BTCUSDT',
  p_interval text default '1h',
  p_exchange text default 'binance'
)
returns table (
  timestamp_utc timestamptz,
  adx_14 numeric,
  plus_di numeric,
  minus_di numeric,
  linreg_slope numeric,
  linreg_r2 numeric,
  garman_klass_vol numeric,
  bb_width numeric,
  bb_percent_b numeric,
  atr_ratio numeric,
  rsi_14 numeric,
  dist_zscore_sma20 numeric,
  dist_zscore_sma50 numeric,
  dist_zscore_sma200 numeric,
  funding_zscore numeric,
  price_change_pct numeric,
  oi_change_pct numeric,
  oi_price_quadrant text,
  cvd_zscore numeric,
  liq_cluster_density numeric,
  net_taker_flow_ratio numeric,
  regime text,
  data_coverage_pct numeric
)
language sql
stable
set search_path to 'public'
as $$
  with candle_base as (
    select open_time, open, high, low, close
    from candles
    where exchange = p_exchange and symbol = p_symbol and interval = p_interval
  ),
  mf as (
    select candle_open_time, rsi_14, adx_14, plus_di, minus_di, atr_14, cvd_delta
    from market_features
    where symbol = p_symbol and interval = p_interval
  ),
  hourly_funding as (
    select distinct on (date_trunc('hour', timestamp_utc))
      date_trunc('hour', timestamp_utc) as bucket_hour, funding_rate
    from market_snapshots
    where exchange = 'bybit' and symbol = p_symbol and status = 'ok' and funding_rate is not null
    order by date_trunc('hour', timestamp_utc), timestamp_utc desc
  ),
  hourly_oi as (
    select distinct on (date_trunc('hour', timestamp_utc))
      date_trunc('hour', timestamp_utc) as bucket_hour, open_interest
    from market_snapshots
    where exchange = p_exchange and symbol = p_symbol and status = 'ok' and open_interest is not null
    order by date_trunc('hour', timestamp_utc), timestamp_utc desc
  ),
  hourly_liq as (
    select date_trunc('hour', event_time_utc) as bucket_hour, sum(notional_usd) as notional
    from liquidation_events
    where symbol = p_symbol
    group by 1
  ),
  hourly_taker as (
    select date_trunc('hour', timestamp_utc) as bucket_hour,
      sum(taker_buy_vol) as buy_vol, sum(taker_sell_vol) as sell_vol
    from spot_market_snapshots
    where exchange = p_exchange and symbol = p_symbol and status = 'ok'
    group by 1
  ),
  grid as (
    select
      cb.open_time,
      cb.close,
      row_number() over (order by cb.open_time) - 1 as idx,
      mf.rsi_14, mf.adx_14, mf.plus_di, mf.minus_di, mf.atr_14, mf.cvd_delta,
      hf.funding_rate,
      hoi.open_interest,
      coalesce(hl.notional, 0) as liq_notional,
      ht.buy_vol, ht.sell_vol,
      0.5 * power(ln(cb.high / cb.low), 2) - (2 * ln(2) - 1) * power(ln(cb.close / cb.open), 2) as gk_term
    from candle_base cb
    left join mf on mf.candle_open_time = cb.open_time
    left join hourly_funding hf on hf.bucket_hour = cb.open_time
    left join hourly_oi hoi on hoi.bucket_hour = cb.open_time
    left join hourly_liq hl on hl.bucket_hour = cb.open_time
    left join hourly_taker ht on ht.bucket_hour = cb.open_time
  ),
  windowed as (
    select
      open_time,
      close,
      adx_14, plus_di, minus_di, rsi_14,

      -- Saeule 1: linreg slope/R^2, window=20
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        then regr_slope(close, idx) over (order by open_time rows between 19 preceding and current row)
      end as linreg_slope,
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        then regr_r2(close, idx) over (order by open_time rows between 19 preceding and current row)
      end as linreg_r2,

      -- Saeule 2: Garman-Klass (window=24), Bollinger (window=20), ATR-Ratio (SMA20 von atr_14)
      case when count(gk_term) over (order by open_time rows between 23 preceding and current row) = 24
        then sqrt(greatest(sum(gk_term) over (order by open_time rows between 23 preceding and current row), 0))
      end as garman_klass_vol,
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        and avg(close) over (order by open_time rows between 19 preceding and current row) <> 0
        then (4 * stddev_pop(close) over (order by open_time rows between 19 preceding and current row))
             / avg(close) over (order by open_time rows between 19 preceding and current row)
      end as bb_width,
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        and stddev_pop(close) over (order by open_time rows between 19 preceding and current row) <> 0
        then (close - (avg(close) over (order by open_time rows between 19 preceding and current row)
              - 2 * stddev_pop(close) over (order by open_time rows between 19 preceding and current row)))
             / (4 * stddev_pop(close) over (order by open_time rows between 19 preceding and current row))
      end as bb_percent_b,
      case when count(atr_14) over (order by open_time rows between 19 preceding and current row) = 20
        and avg(atr_14) over (order by open_time rows between 19 preceding and current row) <> 0
        then atr_14 / avg(atr_14) over (order by open_time rows between 19 preceding and current row)
      end as atr_ratio,

      -- Saeule 3: Distance-to-MA Z-Scores (SMA20/50/200)
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        and stddev_pop(close) over (order by open_time rows between 19 preceding and current row) <> 0
        then (close - avg(close) over (order by open_time rows between 19 preceding and current row))
             / stddev_pop(close) over (order by open_time rows between 19 preceding and current row)
      end as dist_zscore_sma20,
      case when count(*) over (order by open_time rows between 49 preceding and current row) = 50
        and stddev_pop(close) over (order by open_time rows between 49 preceding and current row) <> 0
        then (close - avg(close) over (order by open_time rows between 49 preceding and current row))
             / stddev_pop(close) over (order by open_time rows between 49 preceding and current row)
      end as dist_zscore_sma50,
      case when count(*) over (order by open_time rows between 199 preceding and current row) = 200
        and stddev_pop(close) over (order by open_time rows between 199 preceding and current row) <> 0
        then (close - avg(close) over (order by open_time rows between 199 preceding and current row))
             / stddev_pop(close) over (order by open_time rows between 199 preceding and current row)
      end as dist_zscore_sma200,

      -- Saeule 4: Funding-Z-Score (window=90), OI/Preis-Matrix (window=6h), CVD-Z-Score (window=48)
      case when count(funding_rate) over (order by open_time rows between 89 preceding and current row) = 90
        and stddev_samp(funding_rate) over (order by open_time rows between 89 preceding and current row) <> 0
        then (funding_rate - avg(funding_rate) over (order by open_time rows between 89 preceding and current row))
             / stddev_samp(funding_rate) over (order by open_time rows between 89 preceding and current row)
      end as funding_zscore,
      case when lag(close, 6) over (order by open_time) is not null and lag(close, 6) over (order by open_time) <> 0
        then 100.0 * (close - lag(close, 6) over (order by open_time)) / lag(close, 6) over (order by open_time)
      end as price_change_pct,
      case when lag(open_interest, 6) over (order by open_time) is not null and lag(open_interest, 6) over (order by open_time) <> 0
        then 100.0 * (open_interest - lag(open_interest, 6) over (order by open_time)) / lag(open_interest, 6) over (order by open_time)
      end as oi_change_pct,
      case when count(cvd_delta) over (order by open_time rows between 47 preceding and current row) = 48
        and stddev_samp(cvd_delta) over (order by open_time rows between 47 preceding and current row) <> 0
        then (cvd_delta - avg(cvd_delta) over (order by open_time rows between 47 preceding and current row))
             / stddev_samp(cvd_delta) over (order by open_time rows between 47 preceding and current row)
      end as cvd_zscore,

      -- Saeule 5: Liquidation-Cluster-Density (6h-Cluster vs. 48h-Baseline), Net-Taker-Flow-Ratio
      sum(liq_notional) over (order by open_time rows between 5 preceding and current row) as liq_cluster_sum,
      case when (coalesce(buy_vol, 0) + coalesce(sell_vol, 0)) <> 0
        then (buy_vol - sell_vol) / (buy_vol + sell_vol)
      end as net_taker_flow_ratio,

      -- Datenabdeckung dieser Zeile: Anteil der 20 Kern-Saeulen-Spalten, die
      -- tatsaechlich befuellt sind (nicht NULL) -- SAME Philosophie wie
      -- market_states.data_coverage_pct: nie ein Ergebnis erfinden, aber
      -- transparent machen, wie vollstaendig die Datenbasis war.
      (
        (case when adx_14 is not null then 1 else 0 end) +
        (case when plus_di is not null then 1 else 0 end) +
        (case when minus_di is not null then 1 else 0 end) +
        (case when rsi_14 is not null then 1 else 0 end) +
        (case when atr_14 is not null then 1 else 0 end) +
        (case when funding_rate is not null then 1 else 0 end) +
        (case when open_interest is not null then 1 else 0 end) +
        (case when cvd_delta is not null then 1 else 0 end)
      )::numeric / 8.0 * 100.0 as data_coverage_pct
    from grid
  ),
  with_liq_density as (
    select
      *,
      case when count(*) over (order by open_time rows between 47 preceding and current row) = 48
        and stddev_samp(liq_cluster_sum) over (order by open_time rows between 47 preceding and current row) <> 0
        then (liq_cluster_sum - avg(liq_cluster_sum) over (order by open_time rows between 47 preceding and current row))
             / stddev_samp(liq_cluster_sum) over (order by open_time rows between 47 preceding and current row)
      end as liq_cluster_density
    from windowed
  )
  select
    open_time as timestamp_utc,
    adx_14,
    plus_di,
    minus_di,
    linreg_slope,
    linreg_r2,
    garman_klass_vol,
    bb_width,
    bb_percent_b,
    atr_ratio,
    rsi_14,
    dist_zscore_sma20,
    dist_zscore_sma50,
    dist_zscore_sma200,
    funding_zscore,
    price_change_pct,
    oi_change_pct,
    case
      when price_change_pct is null or oi_change_pct is null then null
      when price_change_pct > 0 and oi_change_pct > 0 then 'long_buildup'
      when price_change_pct < 0 and oi_change_pct > 0 then 'short_buildup'
      when price_change_pct > 0 and oi_change_pct < 0 then 'short_covering'
      when price_change_pct < 0 and oi_change_pct < 0 then 'long_unwind'
      else 'neutral'
    end as oi_price_quadrant,
    cvd_zscore,
    liq_cluster_density,
    net_taker_flow_ratio,
    public.classify_market_regime(
      adx_14::numeric, plus_di::numeric, minus_di::numeric, linreg_slope::numeric,
      bb_width::numeric, atr_ratio::numeric, dist_zscore_sma50::numeric
    ) as regime,
    data_coverage_pct
  from with_liq_density
  order by open_time;
$$;


-- Berechnet die aktuelle Zeitreihe neu und schreibt sie (upsert) in
-- market_state_matrix. Gleiche Sicherheits-/Grant-Konvention wie das
-- bestehende refresh_data_quality(): SECURITY INVOKER (kein DEFINER),
-- Execute an public/anon/authenticated/service_role granted -- ein
-- oeffentlich lesbares Monitoring-Dashboard, keine sensiblen/Nutzer-
-- spezifischen Daten, das Aufrufen dieser Funktion loest nur eine
-- Neuberechnung aus bereits oeffentlichen Marktdaten aus.
create or replace function public.refresh_market_state_matrix(
  p_symbol text default 'BTCUSDT',
  p_interval text default '1h',
  p_exchange text default 'binance'
)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  insert into public.market_state_matrix (
    timestamp_utc, symbol, interval,
    adx_14, plus_di, minus_di, linreg_slope, linreg_r2,
    garman_klass_vol, bb_width, bb_percent_b, atr_ratio,
    rsi_14, dist_zscore_sma20, dist_zscore_sma50, dist_zscore_sma200,
    funding_zscore, price_change_pct, oi_change_pct, oi_price_quadrant, cvd_zscore,
    liq_cluster_density, net_taker_flow_ratio,
    regime, data_coverage_pct
  )
  select
    s.timestamp_utc, p_symbol, p_interval,
    s.adx_14, s.plus_di, s.minus_di, s.linreg_slope, s.linreg_r2,
    s.garman_klass_vol, s.bb_width, s.bb_percent_b, s.atr_ratio,
    s.rsi_14, s.dist_zscore_sma20, s.dist_zscore_sma50, s.dist_zscore_sma200,
    s.funding_zscore, s.price_change_pct, s.oi_change_pct, s.oi_price_quadrant, s.cvd_zscore,
    s.liq_cluster_density, s.net_taker_flow_ratio,
    s.regime, s.data_coverage_pct
  from public.compute_market_state_matrix_series(p_symbol, p_interval, p_exchange) s
  on conflict (timestamp_utc, symbol, interval) do update set
    adx_14 = excluded.adx_14, plus_di = excluded.plus_di, minus_di = excluded.minus_di,
    linreg_slope = excluded.linreg_slope, linreg_r2 = excluded.linreg_r2,
    garman_klass_vol = excluded.garman_klass_vol, bb_width = excluded.bb_width,
    bb_percent_b = excluded.bb_percent_b, atr_ratio = excluded.atr_ratio,
    rsi_14 = excluded.rsi_14, dist_zscore_sma20 = excluded.dist_zscore_sma20,
    dist_zscore_sma50 = excluded.dist_zscore_sma50, dist_zscore_sma200 = excluded.dist_zscore_sma200,
    funding_zscore = excluded.funding_zscore, price_change_pct = excluded.price_change_pct,
    oi_change_pct = excluded.oi_change_pct, oi_price_quadrant = excluded.oi_price_quadrant,
    cvd_zscore = excluded.cvd_zscore, liq_cluster_density = excluded.liq_cluster_density,
    net_taker_flow_ratio = excluded.net_taker_flow_ratio, regime = excluded.regime,
    data_coverage_pct = excluded.data_coverage_pct;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.classify_market_regime(numeric, numeric, numeric, numeric, numeric, numeric, numeric) to anon, authenticated;
grant execute on function public.compute_market_state_matrix_series(text, text, text) to anon, authenticated;
grant execute on function public.refresh_market_state_matrix(text, text, text) to anon, authenticated;
