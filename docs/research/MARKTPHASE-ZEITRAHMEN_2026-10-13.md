# Marktphase je Zeitrahmen — SQL für den Supabase-Editor (13.10.2026)

Die Kachel „Marktphase“ folgt der Zeitraum-Auswahl oben (15M und 1H → 1h-Kerzen,
4H → 4h, 24H → 1d, 1W/1M → 1w). 15m ist bewusst nicht dabei (Entscheid Toby 13.10.2026:
für Stundenkerzen gewählte Schwellen schlagen dort zu oft um). Für 1h bleibt alles wie bisher: Die Kachel liest die
gespeicherte Tabelle `market_state_matrix`. Für die anderen Zeitrahmen rechnet die neue
Funktion `compute_market_state_matrix_latest` den aktuellen Wert live aus den letzten 400
Kerzen. Es wird nichts zusätzlich gespeichert, und es gibt keinen neuen Cron-Job.

**Warum eine eigene Funktion:** `compute_market_state_matrix_series` rechnet immer die
ganze Historie (15m: 144'000 Kerzen, rund 20 Sekunden). Die neue Funktion nimmt dieselben
Formeln, aber nur die letzten 400 Kerzen. Das reicht für das längste Fenster (SMA200). Am
13.10. live geprüft: Der letzte Wert ist auf 15m identisch mit der vollen Berechnung
(Regime, ADX, Steigung, Bollinger, ATR-Ratio, Z-Scores, CVD).

**So ausführen:** Supabase → SQL Editor, den Block einmal ausführen. Erst danach den
App-PR mergen, sonst zeigt die Kachel ausserhalb von 1H „keine Daten“.

```sql
create or replace function public.compute_market_state_matrix_latest(
  p_symbol text default 'BTCUSDT',
  p_interval text default '1h',
  p_exchange text default 'binance',
  p_bars integer default 400
)
returns table(
  timestamp_utc timestamptz, adx_14 numeric, plus_di numeric, minus_di numeric,
  linreg_slope numeric, linreg_r2 numeric, garman_klass_vol numeric, bb_width numeric,
  bb_percent_b numeric, atr_ratio numeric, rsi_14 numeric, dist_zscore_sma20 numeric,
  dist_zscore_sma50 numeric, dist_zscore_sma200 numeric, funding_zscore numeric,
  price_change_pct numeric, oi_change_pct numeric, oi_price_quadrant text, cvd_zscore numeric,
  liq_cluster_density numeric, net_taker_flow_ratio numeric, regime text, data_coverage_pct numeric
)
language sql
stable
set search_path to 'public'
as $function$
-- Gleiche Formeln wie compute_market_state_matrix_series, aber nur ueber die
-- letzten p_bars Kerzen und nur die juengste Zeile (Kachel "Marktphase" je
-- Zeitrahmen, siehe components/RegimeMatrixCard.tsx).
  with candle_base as (
    select open_time, open, high, low, close
    from (
      select open_time, open, high, low, close
      from candles
      where exchange = p_exchange and symbol = p_symbol and interval = p_interval
      order by open_time desc
      limit p_bars
    ) recent
  ),
  since as (
    select min(open_time) as t0 from candle_base
  ),
  mf as (
    select candle_open_time, rsi_14, adx_14, plus_di, minus_di, atr_14, cvd_delta
    from market_features
    where symbol = p_symbol and interval = p_interval
      and candle_open_time >= (select t0 from since)
  ),
  hourly_funding as (
    select distinct on (date_trunc('hour', timestamp_utc))
      date_trunc('hour', timestamp_utc) as bucket_hour, funding_rate
    from market_snapshots
    where exchange = 'bybit' and symbol = p_symbol and status = 'ok' and funding_rate is not null
      and timestamp_utc >= (select t0 from since)
    order by date_trunc('hour', timestamp_utc), timestamp_utc desc
  ),
  hourly_oi as (
    select distinct on (date_trunc('hour', timestamp_utc))
      date_trunc('hour', timestamp_utc) as bucket_hour, open_interest
    from market_snapshots
    where exchange = p_exchange and symbol = p_symbol and status = 'ok' and open_interest is not null
      and timestamp_utc >= (select t0 from since)
    order by date_trunc('hour', timestamp_utc), timestamp_utc desc
  ),
  hourly_liq as (
    select date_trunc('hour', event_time_utc) as bucket_hour, sum(notional_usd) as notional
    from liquidation_events
    where symbol = p_symbol
      and event_time_utc >= (select t0 from since)
    group by 1
  ),
  hourly_taker as (
    select date_trunc('hour', timestamp_utc) as bucket_hour,
      sum(taker_buy_vol) as buy_vol, sum(taker_sell_vol) as sell_vol
    from spot_market_snapshots
    where exchange = p_exchange and symbol = p_symbol and status = 'ok'
      and timestamp_utc >= (select t0 from since)
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
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        then regr_slope(close, idx) over (order by open_time rows between 19 preceding and current row)
      end as linreg_slope,
      case when count(*) over (order by open_time rows between 19 preceding and current row) = 20
        then regr_r2(close, idx) over (order by open_time rows between 19 preceding and current row)
      end as linreg_r2,
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
      sum(liq_notional) over (order by open_time rows between 5 preceding and current row) as liq_cluster_sum,
      case when (coalesce(buy_vol, 0) + coalesce(sell_vol, 0)) <> 0
        then (buy_vol - sell_vol) / (buy_vol + sell_vol)
      end as net_taker_flow_ratio,
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
    adx_14, plus_di, minus_di, linreg_slope, linreg_r2, garman_klass_vol, bb_width, bb_percent_b,
    atr_ratio, rsi_14, dist_zscore_sma20, dist_zscore_sma50, dist_zscore_sma200, funding_zscore,
    price_change_pct, oi_change_pct,
    case
      when price_change_pct is null or oi_change_pct is null then null
      when price_change_pct > 0 and oi_change_pct > 0 then 'long_buildup'
      when price_change_pct < 0 and oi_change_pct > 0 then 'short_buildup'
      when price_change_pct > 0 and oi_change_pct < 0 then 'short_covering'
      when price_change_pct < 0 and oi_change_pct < 0 then 'long_unwind'
      else 'neutral'
    end as oi_price_quadrant,
    cvd_zscore, liq_cluster_density, net_taker_flow_ratio,
    public.classify_market_regime(
      adx_14::numeric, plus_di::numeric, minus_di::numeric, linreg_slope::numeric,
      bb_width::numeric, atr_ratio::numeric, dist_zscore_sma50::numeric
    ) as regime,
    data_coverage_pct
  from with_liq_density
  order by open_time desc
  limit 1
;
$function$;

grant execute on function public.compute_market_state_matrix_latest(text, text, text, integer) to anon, authenticated;

-- Kontrolle: je eine Zeile fuer 4h, 1d und 1w
select '4h' tf, timestamp_utc, regime, round(adx_14, 1) adx from public.compute_market_state_matrix_latest('BTCUSDT', '4h')
union all
select '1d', timestamp_utc, regime, round(adx_14, 1) from public.compute_market_state_matrix_latest('BTCUSDT', '1d')
union all
select '1w', timestamp_utc, regime, round(adx_14, 1) from public.compute_market_state_matrix_latest('BTCUSDT', '1w');
```
