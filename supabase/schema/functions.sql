-- Stand aller Funktionen im Schema public (pg_get_functiondef)

CREATE OR REPLACE FUNCTION public._dq_evaluate(p_last_success_at timestamp with time zone, p_data_timestamp timestamp with time zone, p_expected_interval_seconds integer, p_staleness_multiplier numeric, p_error_rate numeric, p_missing_value_rate numeric, p_latest_is_error boolean)
 RETURNS TABLE(status text, quality_score numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_age_seconds numeric;
  v_freshness numeric;
  v_reliability numeric;
  v_completeness numeric;
  v_score numeric;
begin
  if p_last_success_at is null then
    return query select 'UNKNOWN'::text, null::numeric;
    return;
  end if;

  v_age_seconds := extract(epoch from (now() - coalesce(p_data_timestamp, p_last_success_at)));

  -- Frische: volle Punktzahl bis zum erwarteten Intervall, danach linearer
  -- Abfall bis zur Stale-Schwelle.
  v_freshness := case
    when v_age_seconds <= p_expected_interval_seconds then 50
    when v_age_seconds >= p_expected_interval_seconds * p_staleness_multiplier then 0
    else 50 * (1 - (v_age_seconds - p_expected_interval_seconds) / (p_expected_interval_seconds * (p_staleness_multiplier - 1)))
  end;

  v_reliability := coalesce(30 * (1 - p_error_rate), 30);
  v_completeness := coalesce(20 * (1 - p_missing_value_rate), 20);
  v_score := round(greatest(0, least(100, v_freshness + v_reliability + v_completeness))::numeric, 2);

  if coalesce(p_latest_is_error, false) then
    return query select 'ERROR'::text, v_score;
  elsif v_age_seconds > p_expected_interval_seconds * p_staleness_multiplier then
    return query select 'STALE'::text, v_score;
  elsif v_score < 60 then
    return query select 'DEGRADED'::text, v_score;
  elsif v_score >= 60 and coalesce(p_missing_value_rate, 0) = 0 and coalesce(p_error_rate, 0) = 0 then
    return query select 'VALIDATED'::text, v_score;
  else
    return query select 'LIVE'::text, v_score;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.baseline_signal_state(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with vals as (
    select key as factor_name, (value->>'value')::numeric as v
    from jsonb_each(p_factors)
  ),
  with_data as (
    select factor_name, v from vals where v is not null
  ),
  agg as (
    select
      (select count(*) from vals) as total_factors,
      count(*) as with_data_count,
      coalesce(sum(v), 0) as score,
      count(*) filter (where v > 0) as positive_count,
      count(*) filter (where v < 0) as negative_count
    from with_data
  )
  select jsonb_build_object(
    'data_coverage_pct', round(100.0 * a.with_data_count / nullif(a.total_factors,0), 1),
    'score', a.score,
    'overall_state',
      case
        when a.with_data_count = 0 or (100.0 * a.with_data_count / nullif(a.total_factors,0)) < 40 then 'INSUFFICIENT_DATA'
        when a.score >= 3 then 'BULLISH'
        when a.score <= -3 then 'BEARISH'
        when a.positive_count > 0 and a.negative_count > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when a.with_data_count = 0 or (100.0 * a.with_data_count / nullif(a.total_factors,0)) < 40 then 0
        else round((100.0 * a.with_data_count / nullif(a.total_factors,0) / 100) * (abs(a.score) / a.with_data_count) * 100)
      end,
    'architecture_version', 'baseline_v1'
  )
  from agg a;
$function$;

CREATE OR REPLACE FUNCTION public.calibrated_v1_signal_state(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'market_structure'), ('vwap_position', 'market_structure'),
      ('momentum', 'momentum_trend'), ('trend_strength', 'momentum_trend'), ('trend_regime', 'momentum_trend'),
      ('cvd', 'order_flow'), ('orderbook', 'order_flow'),
      ('oi_price', 'derivatives_leverage'), ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'), ('basis', 'derivatives_leverage'),
      ('options', 'options'), ('macro', 'macro_liquidity'), ('sentiment', 'sentiment')
  ),
  domain_weights(domain, weight) as (
    values
      ('market_structure', 1.17), ('momentum_trend', 0.93), ('order_flow', 0.945),
      ('derivatives_leverage', 1.0), ('options', 1.0), ('macro_liquidity', 1.0), ('sentiment', 1.0)
  ),
  factor_values as (
    select dm.factor_name, dm.domain, nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select domain, avg(value) as domain_score, count(value) as factors_with_data, count(*) as factors_total
    from factor_values group by domain
  ),
  domain_with_data as (
    select da.*, dw.weight from domain_agg da join domain_weights dw using (domain) where da.domain_score is not null
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score * weight), 0) as weighted_score,
      coalesce(sum(weight), 0) as weight_sum,
      count(*) filter (where domain_score * weight > 0) as positive_domains,
      count(*) filter (where domain_score * weight < 0) as negative_domains
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_scores', (
      select coalesce(jsonb_object_agg(da.domain, jsonb_build_object(
        'score', round(da.domain_score, 4), 'weight', dw.weight,
        'weighted_score', round(da.domain_score * dw.weight, 4),
        'factors_with_data', da.factors_with_data, 'factors_total', da.factors_total
      )), '{}'::jsonb)
      from domain_agg da join domain_weights dw using (domain)
    ),
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.domains_total = 0 or o.domains_with_data = 0 or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.domains_total = 0 or o.domains_with_data = 0 or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 0
        else round((o.domains_with_data::numeric / o.domains_total) * (abs(o.weighted_score) / nullif(o.weight_sum,0)) * 100)
      end,
    'architecture_version', 'calibrated_v1',
    'note', 'Domain-Gewichte NUR aus TRAIN gelernt (market_structure/momentum_trend/order_flow), mild regularisiert (SHRINKAGE_K=0.05, geclippt [0.5,2.0]). derivatives_leverage/options/macro_liquidity/sentiment bleiben bei 1.0 -- TRAIN-Historie dort unzureichend (siehe Phase-5-Audit).'
  )
  from overall o;
$function$;

CREATE OR REPLACE FUNCTION public.calibrated_v1_signal_state_covfix(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'market_structure'), ('vwap_position', 'market_structure'),
      ('momentum', 'momentum_trend'), ('trend_strength', 'momentum_trend'), ('trend_regime', 'momentum_trend'),
      ('cvd', 'order_flow'), ('orderbook', 'order_flow'),
      ('oi_price', 'derivatives_leverage'), ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'), ('basis', 'derivatives_leverage'),
      ('options', 'options'), ('macro', 'macro_liquidity'), ('sentiment', 'sentiment')
  ),
  domain_weights(domain, weight) as (
    values
      ('market_structure', 1.17), ('momentum_trend', 0.93), ('order_flow', 0.945),
      ('derivatives_leverage', 1.0), ('options', 1.0), ('macro_liquidity', 1.0), ('sentiment', 1.0)
  ),
  factor_values as (
    select dm.factor_name, dm.domain, nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select domain, avg(value) as domain_score, count(value) as factors_with_data, count(*) as factors_total
    from factor_values group by domain
  ),
  domain_with_data as (
    select da.*, dw.weight from domain_agg da join domain_weights dw using (domain) where da.domain_score is not null
  ),
  factor_coverage as (
    select count(*) filter (where value is not null) as factors_with_data, count(*) as factors_total
    from factor_values
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score * weight), 0) as weighted_score,
      coalesce(sum(weight), 0) as weight_sum,
      count(*) filter (where domain_score * weight > 0) as positive_domains,
      count(*) filter (where domain_score * weight < 0) as negative_domains,
      (select factors_with_data from factor_coverage) as factors_with_data,
      (select factors_total from factor_coverage) as factors_total
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'factor_coverage_pct', round(100.0 * o.factors_with_data / nullif(o.factors_total,0), 1),
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / nullif(o.weight_sum,0)) * 100)
      end,
    'architecture_version', 'calibrated_v1_covfix',
    'note', 'Model C, Coverage-Gate auf Faktor-Ebene (Bugfix, Phase 1) statt Domain-Ebene. Gewichte unveraendert (keine Reoptimierung).'
  )
  from overall o;
$function$;

CREATE OR REPLACE FUNCTION public.classify_market_regime(p_adx numeric, p_plus_di numeric, p_minus_di numeric, p_slope numeric, p_bandwidth numeric, p_atr_ratio numeric, p_dist_zscore_sma50 numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
    when p_adx >= 20 and p_adx < 25 and p_plus_di > p_minus_di and p_slope > 0
      then 'TREND_FORMING_BULLISH'
    when p_adx >= 20 and p_adx < 25 and p_minus_di > p_plus_di and p_slope < 0
      then 'TREND_FORMING_BEARISH'
    when p_adx < 20 and p_bandwidth <= 0.05
      then 'VOLA_SQUEEZE_RANGING'
    else 'UNRESOLVED_NEUTRAL'
  end;
$function$;

CREATE OR REPLACE FUNCTION public.compute_market_state_matrix_latest(p_symbol text DEFAULT 'BTCUSDT'::text, p_interval text DEFAULT '1h'::text, p_exchange text DEFAULT 'binance'::text, p_bars integer DEFAULT 400)
 RETURNS TABLE(timestamp_utc timestamp with time zone, adx_14 numeric, plus_di numeric, minus_di numeric, linreg_slope numeric, linreg_r2 numeric, garman_klass_vol numeric, bb_width numeric, bb_percent_b numeric, atr_ratio numeric, rsi_14 numeric, dist_zscore_sma20 numeric, dist_zscore_sma50 numeric, dist_zscore_sma200 numeric, funding_zscore numeric, price_change_pct numeric, oi_change_pct numeric, oi_price_quadrant text, cvd_zscore numeric, liq_cluster_density numeric, net_taker_flow_ratio numeric, regime text, data_coverage_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.compute_market_state_matrix_series(p_symbol text DEFAULT 'BTCUSDT'::text, p_interval text DEFAULT '1h'::text, p_exchange text DEFAULT 'binance'::text)
 RETURNS TABLE(timestamp_utc timestamp with time zone, adx_14 numeric, plus_di numeric, minus_di numeric, linreg_slope numeric, linreg_r2 numeric, garman_klass_vol numeric, bb_width numeric, bb_percent_b numeric, atr_ratio numeric, rsi_14 numeric, dist_zscore_sma20 numeric, dist_zscore_sma50 numeric, dist_zscore_sma200 numeric, funding_zscore numeric, price_change_pct numeric, oi_change_pct numeric, oi_price_quadrant text, cvd_zscore numeric, liq_cluster_density numeric, net_taker_flow_ratio numeric, regime text, data_coverage_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.compute_signal_stats(p_window text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_min_n constant integer := 10;
  v_upserted integer;
begin
  if p_window not in ('90d', 'all') then
    raise exception 'p_window muss 90d oder all sein, war: %', p_window;
  end if;

  with baselines as (
    select h.horizon_hours, b.*
    from (select unnest(array[4, 12, 24]) as horizon_hours) h
    cross join lateral public.signal_baseline_stats(h.horizon_hours, p_window) b
  ),
  groups as (
    select
      so.category, so.signal_type, so.horizon_hours, so.direction_expected,
      count(*) as n,
      avg(case when so.hit then 1.0 else 0.0 end) as hit_rate,
      avg(so.return_pct) as avg_return_pct,
      avg(abs(so.return_pct)) as avg_abs_return_pct
    from public.signal_outcomes so
    where so.filled_at is not null
      and (p_window <> '90d' or so.fired_at >= now() - interval '90 days')
    group by 1, 2, 3, 4
  ),
  scored as (
    select
      g.category, g.signal_type, g.horizon_hours, g.direction_expected,
      case when g.direction_expected is not null then 'directional' else 'magnitude' end as test_type,
      g.n,
      case when g.direction_expected is not null then round(g.hit_rate * 100, 2) else null end as hit_rate_pct,
      case
        when g.direction_expected = 'bullish' then round(b.baseline_bullish_rate * 100, 2)
        when g.direction_expected = 'bearish' then round(b.baseline_bearish_rate * 100, 2)
        else null
      end as baseline_hit_rate_pct,
      round(g.avg_return_pct, 4) as avg_return_pct,
      round(g.avg_abs_return_pct, 4) as avg_abs_return_pct,
      case when g.direction_expected is null then round(b.avg_abs_return_pct, 4) else null end as baseline_avg_abs_return_pct,
      case
        when g.n < v_min_n then null
        when g.direction_expected = 'bullish' and b.baseline_bullish_rate > 0 and b.baseline_bullish_rate < 1 then
          2 * (1 - public.research_norm_cdf(abs((g.hit_rate - b.baseline_bullish_rate) / sqrt(b.baseline_bullish_rate * (1 - b.baseline_bullish_rate) / g.n))::numeric))
        when g.direction_expected = 'bearish' and b.baseline_bearish_rate > 0 and b.baseline_bearish_rate < 1 then
          2 * (1 - public.research_norm_cdf(abs((g.hit_rate - b.baseline_bearish_rate) / sqrt(b.baseline_bearish_rate * (1 - b.baseline_bearish_rate) / g.n))::numeric))
        when g.direction_expected is null and b.stddev_abs_return_pct > 0 then
          2 * (1 - public.research_norm_cdf(abs((g.avg_abs_return_pct - b.avg_abs_return_pct) / (b.stddev_abs_return_pct / sqrt(g.n::numeric)))::numeric))
        else null
      end as raw_p_value
    from groups g
    join baselines b on b.horizon_hours = g.horizon_hours
  ),
  ranked as (
    select *,
      case when raw_p_value is not null then rank() over (order by raw_p_value) end as rnk,
      count(*) filter (where raw_p_value is not null) over () as m
    from scored
  ),
  upserted as (
    insert into public.signal_stats_results (
      window_label, category, signal_type, horizon_hours, direction_expected, test_type,
      n, hit_rate_pct, baseline_hit_rate_pct, avg_return_pct, avg_abs_return_pct,
      baseline_avg_abs_return_pct, raw_p_value, rank, bh_critical_value, significant_after_bh, computed_at
    )
    select
      p_window, category, signal_type, horizon_hours, direction_expected, test_type,
      n, hit_rate_pct, baseline_hit_rate_pct, avg_return_pct, avg_abs_return_pct,
      baseline_avg_abs_return_pct, round(raw_p_value, 4), rnk,
      case when rnk is not null then round((rnk::numeric / nullif(m, 0)) * 0.05, 4) end,
      case when rnk is not null and m > 0 then raw_p_value <= (rnk::numeric / m) * 0.05 else null end,
      now()
    from ranked
    on conflict (window_label, category, signal_type, horizon_hours) do update set
      direction_expected = excluded.direction_expected,
      test_type = excluded.test_type,
      n = excluded.n,
      hit_rate_pct = excluded.hit_rate_pct,
      baseline_hit_rate_pct = excluded.baseline_hit_rate_pct,
      avg_return_pct = excluded.avg_return_pct,
      avg_abs_return_pct = excluded.avg_abs_return_pct,
      baseline_avg_abs_return_pct = excluded.baseline_avg_abs_return_pct,
      raw_p_value = excluded.raw_p_value,
      rank = excluded.rank,
      bh_critical_value = excluded.bh_critical_value,
      significant_after_bh = excluded.significant_after_bh,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_upserted from upserted;

  return v_upserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_onchain_vs_price_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.onchain_vs_price,
      case s.onchain_vs_price
        when 'PRICE_HIGH_SOPR_LOSS' then 'onchain_vs_price_bearish'
        when 'PRICE_LOW_SOPR_PROFIT' then 'onchain_vs_price_bullish'
        else null
      end as signal_type,
      case s.onchain_vs_price
        when 'PRICE_HIGH_SOPR_LOSS' then 'bearish'
        when 'PRICE_LOW_SOPR_PROFIT' then 'bullish'
        else null
      end as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.onchain_vs_price) over (order by r.id) as prev_value
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and onchain_vs_price is distinct from prev_value and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_overall_state_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with state_rows as (
    select
      ms.id,
      ms.timestamp_utc,
      ms.overall_state,
      case ms.overall_state
        when 'BULLISH' then 'overall_state_bullish'
        when 'BEARISH' then 'overall_state_bearish'
        else null
      end as signal_type,
      case ms.overall_state
        when 'BULLISH' then 'bullish'
        when 'BEARISH' then 'bearish'
        else null
      end as direction_expected,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price
    from public.market_states ms
  ),
  transitions as (
    select
      sr.*,
      lag(sr.overall_state) over (order by sr.id) as prev_overall_state
    from state_rows sr
  ),
  fired as (
    select * from transitions
    where signal_type is not null
      and overall_state is distinct from prev_overall_state
      and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'core_engine',
    f.signal_type,
    f.direction_expected,
    f.timestamp_utc,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_regime_matrix_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with matrix_rows as (
    select
      mm.id,
      mm.timestamp_utc,
      mm.regime,
      case mm.regime
        when 'TREND_EXPANSION_BULLISH' then 'regime_matrix_bullish'
        when 'TREND_EXPANSION_BEARISH' then 'regime_matrix_bearish'
        else null
      end as signal_type,
      case mm.regime
        when 'TREND_EXPANSION_BULLISH' then 'bullish'
        when 'TREND_EXPANSION_BEARISH' then 'bearish'
        else null
      end as direction_expected,
      c.close as close_price
    from public.market_state_matrix mm
    left join public.candles c
      on c.exchange = 'binance'
      and c.symbol = 'BTCUSDT'
      and c.interval = '1h'
      and c.open_time = mm.timestamp_utc
    where mm.symbol = 'BTCUSDT' and mm.interval = '1h'
  ),
  transitions as (
    select
      mr.*,
      lag(mr.regime) over (order by mr.id) as prev_regime
    from matrix_rows mr
  ),
  fired as (
    select * from transitions
    where signal_type is not null
      and regime is distinct from prev_regime
      and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'core_engine',
    f.signal_type,
    f.direction_expected,
    f.timestamp_utc,
    f.close_price,
    h.horizon_hours,
    'market_state_matrix',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_risk_factor_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with state_rows as (
    select
      ms.id,
      ms.created_at,
      coalesce(ms.risk_factors, '[]'::jsonb) as risk_factor_list,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price,
      (ms.factors->'funding'->'basis'->>'avg_current_rate')::numeric as funding_rate,
      (ms.factors->'basis'->'basis'->>'basis_pct')::numeric as basis_pct
    from public.market_states ms
  ),
  factor_defs (factor_name) as (
    values ('warning_pattern'), ('low_mtf_alignment'), ('elevated_volatility'),
           ('funding_crowding'), ('basis_crowding')
  ),
  transitions as (
    select
      sr.id, sr.created_at, sr.close_price, fd.factor_name,
      case fd.factor_name
        when 'funding_crowding' then
          case when sr.funding_rate > 0 then 'bearish' when sr.funding_rate < 0 then 'bullish' else null end
        when 'basis_crowding' then
          case when sr.basis_pct > 0 then 'bearish' when sr.basis_pct < 0 then 'bullish' else null end
        else null
      end as direction_expected,
      (sr.risk_factor_list ? fd.factor_name) as active_now,
      lag(sr.risk_factor_list ? fd.factor_name) over (partition by fd.factor_name order by sr.id) as active_prev
    from state_rows sr
    cross join factor_defs fd
  ),
  fired as (
    select * from transitions
    where active_now and not coalesce(active_prev, false) and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'risk_factor',
    f.factor_name,
    f.direction_expected,
    f.created_at,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_rsi_divergence_vs_trend_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.rsi_macd_divergence_direction, s.rsi_divergence_vs_trend,
      case
        when s.rsi_macd_divergence_direction is null or s.rsi_divergence_vs_trend not in ('GEGEN_INTAKTEN_TREND', 'OHNE_GEGENTREND')
          then null
        else 'rsi_divergence_' || s.rsi_macd_divergence_direction || '_' ||
          case s.rsi_divergence_vs_trend
            when 'GEGEN_INTAKTEN_TREND' then 'gegentrend'
            else 'ohne_gegentrend'
          end
      end as signal_type,
      s.rsi_macd_divergence_direction as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.signal_type) over (order by r.id) as prev_signal_type
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and signal_type is distinct from prev_signal_type and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_spot_pressure_absorption_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.spot_pressure_vs_price,
      case s.spot_pressure_vs_price
        when 'ABSORPTION_BULLISH' then 'spot_pressure_absorption_bullish'
        when 'ABSORPTION_BEARISH' then 'spot_pressure_absorption_bearish'
        else null
      end as signal_type,
      case s.spot_pressure_vs_price
        when 'ABSORPTION_BULLISH' then 'bullish'
        when 'ABSORPTION_BEARISH' then 'bearish'
        else null
      end as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.spot_pressure_vs_price) over (order by r.id) as prev_value
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and spot_pressure_vs_price is distinct from prev_value and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_spot_pressure_vs_orderbook_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with rows_with_signal as (
    select
      s.id, s.snapshotted_at, s.price, s.spot_pressure_vs_orderbook,
      case s.spot_pressure_vs_orderbook
        when 'RESISTANCE_AHEAD' then 'spot_pressure_orderbook_resistance'
        when 'SUPPORT_AHEAD' then 'spot_pressure_orderbook_support'
        else null
      end as signal_type,
      case s.spot_pressure_vs_orderbook
        when 'RESISTANCE_AHEAD' then 'bearish'
        when 'SUPPORT_AHEAD' then 'bullish'
        else null
      end as direction_expected
    from public.divergence_radar_snapshots s
  ),
  transitions as (
    select r.*, lag(r.spot_pressure_vs_orderbook) over (order by r.id) as prev_value
    from rows_with_signal r
  ),
  fired as (
    select * from transitions
    where signal_type is not null and spot_pressure_vs_orderbook is distinct from prev_value and price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select 'divergence_radar', f.signal_type, f.direction_expected, f.snapshotted_at, f.price,
    h.horizon_hours, 'divergence_radar_snapshots', f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_tradingview_signal_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'tradingview_alert',
    tv.signal_type,
    public.tv_infer_signal_direction(tv.signal_type),
    tv.received_at,
    (tv.payload->>'price')::numeric,
    h.horizon_hours,
    'tradingview_signals',
    tv.id::text
  from public.tradingview_signals tv
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  where public.tv_infer_signal_direction(tv.signal_type) is not null
    and tv.payload->>'price' is not null
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.detect_warning_pattern_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer;
begin
  with pattern_defs (pattern_name, direction_expected) as (
    values
      ('Fragile Bullish', 'bullish'),
      ('Distribution Warning', 'bearish'),
      ('Capitulation', 'bullish'),
      ('Short Squeeze', 'bullish')
  ),
  state_rows as (
    select
      ms.id,
      ms.created_at,
      coalesce(
        (select jsonb_agg(elem->>'name') from jsonb_array_elements(ms.patterns) elem),
        '[]'::jsonb
      ) as pattern_name_list,
      coalesce(
        ms.factors->'oi_price'->'basis'->>'close_price',
        ms.factors->'vwap_position'->'basis'->>'close_price',
        ms.factors->'basis'->'basis'->>'close_price',
        ms.factors->'trend_regime'->'basis'->>'close_price'
      )::numeric as close_price
    from public.market_states ms
  ),
  transitions as (
    select
      sr.id, sr.created_at, sr.close_price, pd.pattern_name, pd.direction_expected,
      (sr.pattern_name_list ? pd.pattern_name) as active_now,
      lag(sr.pattern_name_list ? pd.pattern_name) over (partition by pd.pattern_name order by sr.id) as active_prev
    from state_rows sr
    cross join pattern_defs pd
  ),
  fired as (
    select * from transitions
    where active_now and not coalesce(active_prev, false) and close_price is not null
  )
  insert into public.signal_outcomes (
    category, signal_type, direction_expected, fired_at, price_at_signal,
    horizon_hours, source_table, source_id
  )
  select
    'warning_pattern',
    f.pattern_name,
    f.direction_expected,
    f.created_at,
    f.close_price,
    h.horizon_hours,
    'market_states',
    f.id::text
  from fired f
  cross join (select unnest(array[4, 12, 24]) as horizon_hours) h
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.downsample_old_snapshots(p_older_than interval DEFAULT '35 days'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_cutoff timestamptz := date_trunc('hour', now() - p_older_than);
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
begin
  delete from market_snapshots m
  where m.timestamp_utc < v_cutoff
    and m.id not in (
      select distinct on (exchange, symbol, date_trunc('hour', timestamp_utc)) id
      from market_snapshots where timestamp_utc < v_cutoff
      order by exchange, symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('market_snapshots', v_n);

  delete from positioning_snapshots p
  where p.timestamp_utc < v_cutoff
    and p.id not in (
      select distinct on (exchange, symbol, date_trunc('hour', timestamp_utc)) id
      from positioning_snapshots where timestamp_utc < v_cutoff
      order by exchange, symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_snapshots', v_n);

  delete from positioning_signals s
  where s.timestamp_utc < v_cutoff
    and s.id not in (
      select distinct on (signal_type, symbol, timeframe, date_trunc('hour', timestamp_utc)) id
      from positioning_signals where timestamp_utc < v_cutoff
      order by signal_type, symbol, timeframe, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_signals', v_n);

  delete from orderbook_snapshots o
  where o.timestamp_utc < v_cutoff
    and o.id not in (
      select distinct on (exchange, symbol, date_trunc('hour', timestamp_utc)) id
      from orderbook_snapshots where timestamp_utc < v_cutoff
      order by exchange, symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('orderbook_snapshots', v_n);

  delete from macro_snapshots m
  where m.timestamp_utc < v_cutoff
    and m.id not in (
      select distinct on (symbol, date_trunc('hour', timestamp_utc)) id
      from macro_snapshots where timestamp_utc < v_cutoff
      order by symbol, date_trunc('hour', timestamp_utc), timestamp_utc desc);
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('macro_snapshots', v_n);

  create temp table _spot_hourly on commit drop as
  select exchange, symbol, date_trunc('hour', timestamp_utc) as hour_utc,
         (array_agg(open_price order by timestamp_utc))[1] as open_price,
         (array_agg(last_price order by timestamp_utc desc))[1] as last_price,
         sum(base_volume) as base_volume, sum(quote_volume) as quote_volume,
         sum(taker_buy_vol) as taker_buy_vol, sum(taker_sell_vol) as taker_sell_vol,
         sum(taker_buy_quote_vol) as taker_buy_quote_vol, sum(taker_sell_quote_vol) as taker_sell_quote_vol,
         sum(trade_count)::integer as trade_count
  from spot_market_snapshots
  where timestamp_utc < v_cutoff and status = 'ok' and coalesce(interval_minutes, 5) < 60
  group by 1, 2, 3;

  delete from spot_market_snapshots s
  where s.timestamp_utc < v_cutoff and coalesce(s.interval_minutes, 5) < 60;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('spot_market_snapshots_deleted', v_n);

  insert into spot_market_snapshots (
    timestamp_utc, symbol, exchange, last_price, status, error, interval_minutes, open_price,
    base_volume, quote_volume, taker_buy_vol, taker_sell_vol, taker_buy_quote_vol,
    taker_sell_quote_vol, taker_buy_sell_ratio, trade_count)
  select hour_utc, symbol, exchange, last_price, 'ok', null, 60, open_price,
         base_volume, quote_volume, taker_buy_vol, taker_sell_vol, taker_buy_quote_vol,
         taker_sell_quote_vol,
         case when taker_sell_vol > 0 then taker_buy_vol / taker_sell_vol end, trade_count
  from _spot_hourly
  on conflict (exchange, symbol, timestamp_utc) do nothing;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('spot_market_snapshots_hourly', v_n);

  drop table if exists _spot_hourly;
  return v_result || jsonb_build_object('cutoff', v_cutoff);
end;
$function$;

CREATE OR REPLACE FUNCTION public.experimental_domain_signal_state(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'market_structure'),
      ('vwap_position', 'market_structure'),
      ('momentum', 'momentum_trend'),
      ('trend_strength', 'momentum_trend'),
      ('trend_regime', 'momentum_trend'),
      ('cvd', 'order_flow'),
      ('orderbook', 'order_flow'),
      ('oi_price', 'derivatives_leverage'),
      ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'),
      ('basis', 'derivatives_leverage'),
      ('options', 'options'),
      ('macro', 'macro_liquidity'),
      ('sentiment', 'sentiment')
  ),
  factor_values as (
    select
      dm.factor_name,
      dm.domain,
      nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select
      domain,
      avg(value) as domain_score,
      count(value) as factors_with_data,
      count(*) as factors_total
    from factor_values
    group by domain
  ),
  domain_with_data as (
    select * from domain_agg where domain_score is not null
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score), 0) as weighted_score,
      count(*) filter (where domain_score > 0) as positive_domains,
      count(*) filter (where domain_score < 0) as negative_domains
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_scores', (
      select coalesce(jsonb_object_agg(domain, jsonb_build_object(
        'score', round(domain_score, 4),
        'factors_with_data', factors_with_data,
        'factors_total', factors_total
      )), '{}'::jsonb)
      from domain_agg
    ),
    'domain_coverage_pct',
      case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.domains_total = 0 or o.domains_with_data = 0
          or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.domains_total = 0 or o.domains_with_data = 0
          or (o.domains_with_data::numeric / o.domains_total) < 0.4 then 0
        else round((o.domains_with_data::numeric / o.domains_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'independence_weight_applied', 1.0,
    'architecture_version', 'experimental_domain_v1_phase3',
    'note', 'EXPERIMENTAL -- laeuft parallel zur produktiven compute-market-state Funktion, schreibt in keine Tabelle. Independence-Gewichtung ist ein Platzhalter (1.0), da die bisherige Historie fuer eine kalibrierte Redundanz-Korrektur nicht ausreicht.'
  )
  from overall o;
$function$;

CREATE OR REPLACE FUNCTION public.experimental_domain_signal_state_covfix(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'market_structure'), ('vwap_position', 'market_structure'),
      ('momentum', 'momentum_trend'), ('trend_strength', 'momentum_trend'), ('trend_regime', 'momentum_trend'),
      ('cvd', 'order_flow'), ('orderbook', 'order_flow'),
      ('oi_price', 'derivatives_leverage'), ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'), ('basis', 'derivatives_leverage'),
      ('options', 'options'), ('macro', 'macro_liquidity'), ('sentiment', 'sentiment')
  ),
  factor_values as (
    select dm.factor_name, dm.domain, nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select domain, avg(value) as domain_score, count(value) as factors_with_data, count(*) as factors_total
    from factor_values group by domain
  ),
  domain_with_data as (
    select * from domain_agg where domain_score is not null
  ),
  factor_coverage as (
    select count(*) filter (where value is not null) as factors_with_data, count(*) as factors_total
    from factor_values
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score), 0) as weighted_score,
      count(*) filter (where domain_score > 0) as positive_domains,
      count(*) filter (where domain_score < 0) as negative_domains,
      (select factors_with_data from factor_coverage) as factors_with_data,
      (select factors_total from factor_coverage) as factors_total
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_scores', (
      select coalesce(jsonb_object_agg(domain, jsonb_build_object(
        'score', round(domain_score, 4), 'factors_with_data', factors_with_data, 'factors_total', factors_total
      )), '{}'::jsonb)
      from domain_agg
    ),
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'factor_coverage_pct', round(100.0 * o.factors_with_data / nullif(o.factors_total,0), 1),
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 1.5 then 'BULLISH'
        when o.weighted_score <= -1.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'architecture_version', 'domain_balanced_v1_covfix',
    'note', 'Model B, Coverage-Gate auf Faktor-Ebene (Bugfix, Phase 1) statt Domain-Ebene. Auf aktueller TRAIN+VALIDATION-Basis 0 Zeilen betroffen (Bug war inaktiv, nicht folgenlos falsch).'
  )
  from overall o;
$function$;

CREATE OR REPLACE FUNCTION public.experimental_domain_signal_state_latest()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select public.experimental_domain_signal_state(factors)
  from market_states
  order by timestamp_utc desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.fill_signal_outcomes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_filled integer;
begin
  with due as (
    select so.id, so.price_at_signal, so.direction_expected,
      so.fired_at + (so.horizon_hours || ' hours')::interval as target_time
    from public.signal_outcomes so
    where so.filled_at is null
      and so.fired_at + (so.horizon_hours || ' hours')::interval <= now()
  ),
  matched as (
    select
      d.id, d.price_at_signal, d.direction_expected,
      c.close as outcome_price,
      c.close_time as outcome_at
    from due d
    cross join lateral (
      select c.close, c.close_time
      from public.candles c
      where c.exchange = 'binance'
        and c.symbol = 'BTCUSDT'
        and c.interval = '1h'
        and c.open_time >= d.target_time
        and c.close_time <= now()
      order by c.open_time asc
      limit 1
    ) c
  )
  update public.signal_outcomes so
  set
    outcome_price = m.outcome_price,
    outcome_at = m.outcome_at,
    return_pct = ((m.outcome_price - m.price_at_signal) / m.price_at_signal) * 100,
    hit = case
      when m.direction_expected = 'bullish' then m.outcome_price > m.price_at_signal
      when m.direction_expected = 'bearish' then m.outcome_price < m.price_at_signal
      else null
    end,
    filled_at = now()
  from matched m
  where so.id = m.id;

  get diagnostics v_filled = row_count;
  return v_filled;
end;
$function$;

CREATE OR REPLACE FUNCTION public.funding_only_signal_state(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with fv as (
    select (p_factors->'funding'->>'value')::numeric as v
  )
  select jsonb_build_object(
    'data_coverage_pct', case when v is null then 0 else 100 end,
    'score', coalesce(v, 0),
    'overall_state',
      case
        when v is null then 'INSUFFICIENT_DATA'
        when v > 0 then 'BULLISH'
        when v < 0 then 'BEARISH'
        else 'NEUTRAL'
      end,
    'confidence', case when v is null or v = 0 then 0 else 100 end,
    'architecture_version', 'funding_only_v1'
  )
  from fv;
$function$;

CREATE OR REPLACE FUNCTION public.get_anchored_summary(p_anchor timestamp with time zone, p_anchor_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with bounds as (
    select coalesce(p_anchor_end, now()) as range_end
  ),
  tier as (
    select
      case
        when (select range_end from bounds) - p_anchor < interval '6 hours' then '5m'
        when (select range_end from bounds) - p_anchor <= interval '3 days' then '1h'
        when (select range_end from bounds) - p_anchor <= interval '14 days' then '4h'
        else '1d'
      end as granularity
  ),
  liq as (
    select
      coalesce(sum(notional_usd) filter (where side = 'long'), 0) as long_notional,
      coalesce(sum(notional_usd) filter (where side = 'short'), 0) as short_notional,
      count(*) as event_count
    from liquidation_events
    where status = 'ok'
      and event_time_utc >= p_anchor
      and event_time_utc <= (select range_end from bounds)
      and notional_usd is not null
  ),
  ref_anchor as (
    select last_price, open_interest from get_market_reference_snapshot('aggregated', p_anchor)
  ),
  ref_now as (
    select last_price, open_interest from get_market_reference_snapshot('aggregated', (select range_end from bounds))
  ),
  regime_anchor as (
    select regime, timestamp_utc
    from market_state_matrix
    where timestamp_utc <= p_anchor
    order by timestamp_utc desc
    limit 1
  ),
  confidence_anchor as (
    select confidence
    from market_states
    where timestamp_utc <= p_anchor
    order by timestamp_utc desc
    limit 1
  ),
  series_5m as (
    select s.timestamp_utc, s.last_price, s.open_interest
    from get_market_series('aggregated', p_anchor, 500, (select range_end from bounds)) s
    where (select granularity from tier) = '5m'
  ),
  series_candles as (
    select mf.candle_open_time as timestamp_utc, mf.close_price as last_price, mf.oi_current as open_interest
    from market_features mf
    where mf.symbol = 'BTCUSDT'
      and mf.candle_open_time >= p_anchor
      and mf.candle_open_time <= (select range_end from bounds)
      and (
        ((select granularity from tier) = '1h' and mf.interval = '1h')
        or ((select granularity from tier) = '4h' and mf.interval = '4h')
        or ((select granularity from tier) = '1d' and mf.interval = '1d')
      )
    order by mf.candle_open_time asc
    limit 500
  ),
  series as (
    select * from series_5m
    union all
    select * from series_candles
  )
  select jsonb_build_object(
    'anchor_timestamp_utc', p_anchor,
    'anchor_end_timestamp_utc', p_anchor_end,
    'granularity_used', (select granularity from tier),
    'price_at_anchor', (select last_price from ref_anchor),
    'price_current', (select last_price from ref_now),
    'price_change_pct', (
      select case
        when ref_anchor.last_price is null or ref_anchor.last_price = 0 or ref_now.last_price is null then null
        else ((ref_now.last_price - ref_anchor.last_price) / ref_anchor.last_price) * 100
      end
      from ref_anchor, ref_now
    ),
    'oi_at_anchor', (select open_interest from ref_anchor),
    'oi_current', (select open_interest from ref_now),
    'oi_change_pct', (
      select case
        when ref_anchor.open_interest is null or ref_anchor.open_interest = 0 or ref_now.open_interest is null then null
        else ((ref_now.open_interest - ref_anchor.open_interest) / ref_anchor.open_interest) * 100
      end
      from ref_anchor, ref_now
    ),
    'long_liquidation_usd', (select long_notional from liq),
    'short_liquidation_usd', (select short_notional from liq),
    'liquidation_event_count', (select event_count from liq),
    'regime_at_anchor', (select regime from regime_anchor),
    'regime_at_anchor_timestamp_utc', (select timestamp_utc from regime_anchor),
    'confidence_at_anchor', (select confidence from confidence_anchor),
    'series', coalesce((select jsonb_agg(row_to_json(series) order by series.timestamp_utc) from series), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_anchored_vwap_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_poll_bundle(p_since timestamp with time zone, p_max_points integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'oi_series', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from public.get_market_series('aggregated', p_since, p_max_points) s
    ),
    'oi_reference', (
      select row_to_json(r)
      from public.get_market_reference_snapshot('aggregated', p_since) r
    ),
    'spot_summary', (
      select row_to_json(sp) from public.get_spot_pressure_summary(p_since) sp
    ),
    'spot_series', (
      select coalesce(jsonb_agg(row_to_json(ss)), '[]'::jsonb)
      from public.get_spot_pressure_series(p_since, p_max_points) ss
    ),
    'exchange_first_seen', (
      select coalesce(jsonb_agg(row_to_json(ef)), '[]'::jsonb)
      from public.get_market_snapshot_exchange_first_seen() ef
    ),
    'positioning_binance', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'binance' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_bybit', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'bybit' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_okx', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'okx' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_bitget', (
      select row_to_json(pb) from (
        select * from public.positioning_snapshots
        where exchange = 'bitget' and status = 'ok'
        order by timestamp_utc desc limit 1
      ) pb
    ),
    'positioning_signal', (
      select row_to_json(ps) from (
        select * from public.positioning_signals
        order by timestamp_utc desc limit 1
      ) ps
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_etf_flow_intelligence(p_days integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with daily as (
  select distinct on (flow_date) flow_date, total_flow_usd_m
  from etf_flows
  order by flow_date desc, (source = 'sosovalue') desc
),
windowed as (
  select flow_date, total_flow_usd_m,
    row_number() over (order by flow_date desc) as rn
  from daily
  order by flow_date desc
  limit p_days
),
halves as (
  select
    sum(total_flow_usd_m) filter (where rn <= ceil(p_days::numeric / 2)) as recent_sum,
    count(*) filter (where rn <= ceil(p_days::numeric / 2)) as recent_days,
    sum(total_flow_usd_m) filter (where rn > ceil(p_days::numeric / 2)) as prior_sum,
    count(*) filter (where rn > ceil(p_days::numeric / 2)) as prior_days,
    min(flow_date) as earliest_date,
    max(flow_date) as latest_date,
    count(*) as window_days_used
  from windowed
),
price_bounds as (
  select
    (select close from candles
      where interval = '1d' and symbol = 'BTCUSDT' and exchange = 'binance'
        and open_time <= (select earliest_date from halves)::timestamptz
      order by open_time desc limit 1) as price_start,
    (select close from candles
      where interval = '1d' and symbol = 'BTCUSDT' and exchange = 'binance'
        and open_time <= (select latest_date from halves)::timestamptz
      order by open_time desc limit 1) as price_end
),
oi_series as (
  select timestamp_utc, open_interest
  from get_market_series('aggregated', ((select earliest_date from halves)::timestamptz - interval '1 day'), 20000)
),
oi_bounds as (
  select
    (select open_interest from oi_series
      where timestamp_utc <= (select earliest_date from halves)::timestamptz + interval '1 day'
      order by timestamp_utc desc limit 1) as oi_start,
    (select open_interest from oi_series
      where timestamp_utc <= (select latest_date from halves)::timestamptz + interval '1 day'
      order by timestamp_utc desc limit 1) as oi_end
)
select jsonb_build_object(
  'window_days_used', h.window_days_used,
  'recent_sum_usd_m', h.recent_sum,
  'recent_days', h.recent_days,
  'prior_sum_usd_m', h.prior_sum,
  'prior_days', h.prior_days,
  'momentum_usd_m',
    case when h.recent_sum is not null and h.prior_sum is not null
         then h.recent_sum - h.prior_sum else null end,
  'momentum_pct',
    case when h.recent_sum is not null and h.prior_sum is not null and h.prior_sum <> 0
         then round(((h.recent_sum - h.prior_sum) / abs(h.prior_sum)) * 100, 1)
         else null end,
  'earliest_date', h.earliest_date,
  'latest_date', h.latest_date,
  'price_start', pb.price_start,
  'price_end', pb.price_end,
  'price_change_pct',
    case when pb.price_start is not null and pb.price_end is not null and pb.price_start <> 0
         then round(((pb.price_end - pb.price_start) / pb.price_start) * 100, 2)
         else null end,
  'oi_start', ob.oi_start,
  'oi_end', ob.oi_end,
  'oi_change_pct',
    case when ob.oi_start is not null and ob.oi_end is not null and ob.oi_start <> 0
         then round(((ob.oi_end - ob.oi_start) / ob.oi_start) * 100, 2)
         else null end
)
from halves h, price_bounds pb, oi_bounds ob;
$function$;

CREATE OR REPLACE FUNCTION public.get_funding_intelligence(p_lookback_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with latest_per_exchange as (
    select distinct on (exchange) exchange, funding_rate, timestamp_utc
    from market_snapshots
    where status = 'ok' and funding_rate is not null
      and timestamp_utc >= now() - interval '30 minutes'
    order by exchange, timestamp_utc desc
  ),
  reference_per_exchange as (
    -- Je Boerse der juengste Funding-Rate-Wert VOR dem Lookback-Fenster
    -- (asof, gleiches Prinzip wie get_market_reference_snapshot), damit
    -- das Delta pro Boerse konsistent ueber denselben Zeitraum berechnet
    -- wird statt einen einzelnen globalen Zeitpunkt zu erzwingen.
    select distinct on (m.exchange) m.exchange, m.funding_rate
    from market_snapshots m
    where m.status = 'ok' and m.funding_rate is not null
      and m.timestamp_utc <= now() - (p_lookback_hours || ' hours')::interval
    order by m.exchange, m.timestamp_utc desc
  ),
  per_exchange as (
    select
      l.exchange,
      l.funding_rate as current_rate,
      r.funding_rate as reference_rate,
      l.funding_rate - r.funding_rate as delta
    from latest_per_exchange l
    left join reference_per_exchange r on r.exchange = l.exchange
  ),
  agg as (
    select
      avg(current_rate) as avg_current_rate,
      avg(delta) filter (where delta is not null) as avg_delta,
      max(current_rate) - min(current_rate) as cross_exchange_spread,
      count(*) as exchange_count
    from per_exchange
  )
  select jsonb_build_object(
    'avg_current_rate', (select avg_current_rate from agg),
    'avg_delta', (select avg_delta from agg),
    'cross_exchange_spread', (select cross_exchange_spread from agg),
    'exchange_count', (select exchange_count from agg),
    'per_exchange', coalesce((select jsonb_agg(row_to_json(per_exchange)) from per_exchange), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_liquidation_intelligence(p_since timestamp with time zone, p_bucket_minutes integer DEFAULT 15, p_price_bucket_usd numeric DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with events as (
    select event_time_utc, side, price, notional_usd
    from liquidation_events
    where status = 'ok' and event_time_utc >= p_since and notional_usd is not null
  ),
  velocity as (
    select
      to_timestamp(floor(extract(epoch from event_time_utc) / (p_bucket_minutes * 60)) * (p_bucket_minutes * 60)) as bucket_start,
      count(*) as event_count,
      sum(notional_usd) as notional_usd,
      sum(notional_usd) filter (where side = 'long') as long_notional,
      sum(notional_usd) filter (where side = 'short') as short_notional
    from events
    group by 1
    order by 1
  ),
  price_clusters as (
    select
      round(price / p_price_bucket_usd) * p_price_bucket_usd as price_bucket,
      sum(notional_usd) as notional_usd,
      count(*) as event_count
    from events
    where price is not null
    group by 1
    order by sum(notional_usd) desc
    limit 5
  ),
  oi_ref as (
    select open_interest, last_price
    from get_market_reference_snapshot('aggregated', now())
  )
  select jsonb_build_object(
    'velocity', coalesce((select jsonb_agg(row_to_json(velocity)) from velocity), '[]'::jsonb),
    'price_clusters', coalesce((select jsonb_agg(row_to_json(price_clusters)) from price_clusters), '[]'::jsonb),
    'total_notional_usd', (select coalesce(sum(notional_usd), 0) from events),
    'total_oi_usd', (select open_interest * last_price from oi_ref)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_macro_regime()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with latest as (
    select distinct on (symbol) symbol, label, last_price, prev_close, change_pct, market_time_utc, timestamp_utc
    from macro_snapshots
    where status = 'ok'
    order by symbol, timestamp_utc desc
  ),
  -- Faktor-Klassifikation je Symbol: risk_on / risk_off / neutral.
  -- Schwellenwerte: VIX-Baender folgen der marktueblichen Interpretation
  -- (unter 15 ruhig, ueber 25 erhoeht/Angst -- CBOE-Konvention). Aktien-
  -- /DXY-Tagesbewegung nutzt dieselbe konservative 0.3%/0.5%-Logik wie die
  -- bestehende Marktkontext-Klassifikation (lib/marketContext.ts).
  factors as (
    select
      symbol,
      case
        when symbol = '^VIX' and last_price < 15 then 'risk_on'
        when symbol = '^VIX' and last_price > 25 then 'risk_off'
        when symbol = '^VIX' then 'neutral'
        when symbol in ('^GSPC', '^IXIC') and change_pct > 0.5 then 'risk_on'
        when symbol in ('^GSPC', '^IXIC') and change_pct < -0.5 then 'risk_off'
        when symbol in ('^GSPC', '^IXIC') then 'neutral'
        when symbol = 'DX-Y.NYB' and change_pct < -0.3 then 'risk_on'
        when symbol = 'DX-Y.NYB' and change_pct > 0.3 then 'risk_off'
        when symbol = 'DX-Y.NYB' then 'neutral'
        else 'neutral'
      end as factor
    from latest
    where symbol in ('^VIX', '^GSPC', '^IXIC', 'DX-Y.NYB')
  ),
  net_liquidity as (
    select
      (select last_price from latest where symbol = 'WALCL') as walcl_now,
      (select prev_close from latest where symbol = 'WALCL') as walcl_prev,
      (select last_price from latest where symbol = 'WTREGEN') as tga_now,
      (select prev_close from latest where symbol = 'WTREGEN') as tga_prev,
      (select last_price from latest where symbol = 'RRPONTSYD') as rrp_now,
      (select prev_close from latest where symbol = 'RRPONTSYD') as rrp_prev
  ),
  net_liquidity_calc as (
    select
      case when walcl_now is not null and tga_now is not null and rrp_now is not null
        then walcl_now - tga_now - rrp_now else null end as nl_now,
      case when walcl_prev is not null and tga_prev is not null and rrp_prev is not null
        then walcl_prev - tga_prev - rrp_prev else null end as nl_prev
    from net_liquidity
  ),
  net_liquidity_factor as (
    select
      nl_now,
      nl_prev,
      case when nl_now is not null and nl_prev is not null and nl_prev <> 0
        then round(((nl_now - nl_prev) / abs(nl_prev)) * 100, 3) else null end as nl_change_pct
    from net_liquidity_calc
  ),
  net_liquidity_class as (
    select
      nl_now, nl_prev, nl_change_pct,
      case
        when nl_change_pct is null then null
        when nl_change_pct > 0.5 then 'risk_on'
        when nl_change_pct < -0.5 then 'risk_off'
        else 'neutral'
      end as factor
    from net_liquidity_factor
  ),
  counts as (
    select
      count(*) filter (where factor = 'risk_on') as risk_on_count,
      count(*) filter (where factor = 'risk_off') as risk_off_count,
      count(*) as factor_count
    from (
      select factor from factors
      union all
      select factor from net_liquidity_class where factor is not null
    ) all_factors
  )
  select jsonb_build_object(
    'regime', case
      when (select factor_count from counts) = 0 then null
      when (select risk_on_count from counts) >= 3 and (select risk_off_count from counts) = 0 then 'Risk-On'
      when (select risk_off_count from counts) >= 3 and (select risk_on_count from counts) = 0 then 'Risk-Off'
      when (select risk_on_count from counts) > 0 and (select risk_off_count from counts) > 0 then 'Mixed'
      else 'Neutral'
    end,
    'risk_on_count', (select risk_on_count from counts),
    'risk_off_count', (select risk_off_count from counts),
    'factor_count', (select factor_count from counts),
    'symbols', coalesce((select jsonb_agg(row_to_json(latest)) from latest), '[]'::jsonb),
    'net_liquidity', (select row_to_json(net_liquidity_class) from net_liquidity_class)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_macro_regime_asof(p_asof timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with latest as (
    select distinct on (symbol) symbol, label, last_price, prev_close, change_pct, market_time_utc, timestamp_utc
    from macro_snapshots
    where status = 'ok' and timestamp_utc <= p_asof
    order by symbol, timestamp_utc desc
  ),
  factors as (
    select
      symbol,
      case
        when symbol = '^VIX' and last_price < 15 then 'risk_on'
        when symbol = '^VIX' and last_price > 25 then 'risk_off'
        when symbol = '^VIX' then 'neutral'
        when symbol in ('^GSPC', '^IXIC') and change_pct > 0.5 then 'risk_on'
        when symbol in ('^GSPC', '^IXIC') and change_pct < -0.5 then 'risk_off'
        when symbol in ('^GSPC', '^IXIC') then 'neutral'
        when symbol = 'DX-Y.NYB' and change_pct < -0.3 then 'risk_on'
        when symbol = 'DX-Y.NYB' and change_pct > 0.3 then 'risk_off'
        when symbol = 'DX-Y.NYB' then 'neutral'
        else 'neutral'
      end as factor
    from latest
    where symbol in ('^VIX', '^GSPC', '^IXIC', 'DX-Y.NYB')
  ),
  net_liquidity as (
    select
      (select last_price from latest where symbol = 'WALCL') as walcl_now,
      (select prev_close from latest where symbol = 'WALCL') as walcl_prev,
      (select last_price from latest where symbol = 'WTREGEN') as tga_now,
      (select prev_close from latest where symbol = 'WTREGEN') as tga_prev,
      (select last_price from latest where symbol = 'RRPONTSYD') as rrp_now,
      (select prev_close from latest where symbol = 'RRPONTSYD') as rrp_prev
  ),
  net_liquidity_calc as (
    select
      case when walcl_now is not null and tga_now is not null and rrp_now is not null
        then walcl_now - tga_now - rrp_now else null end as nl_now,
      case when walcl_prev is not null and tga_prev is not null and rrp_prev is not null
        then walcl_prev - tga_prev - rrp_prev else null end as nl_prev
    from net_liquidity
  ),
  net_liquidity_factor as (
    select
      nl_now,
      nl_prev,
      case when nl_now is not null and nl_prev is not null and nl_prev <> 0
        then round(((nl_now - nl_prev) / abs(nl_prev)) * 100, 3) else null end as nl_change_pct
    from net_liquidity_calc
  ),
  net_liquidity_class as (
    select
      nl_now, nl_prev, nl_change_pct,
      case
        when nl_change_pct is null then null
        when nl_change_pct > 0.5 then 'risk_on'
        when nl_change_pct < -0.5 then 'risk_off'
        else 'neutral'
      end as factor
    from net_liquidity_factor
  ),
  counts as (
    select
      count(*) filter (where factor = 'risk_on') as risk_on_count,
      count(*) filter (where factor = 'risk_off') as risk_off_count,
      count(*) as factor_count
    from (
      select factor from factors
      union all
      select factor from net_liquidity_class where factor is not null
    ) all_factors
  )
  select jsonb_build_object(
    'regime', case
      when (select factor_count from counts) = 0 then null
      when (select risk_on_count from counts) >= 3 and (select risk_off_count from counts) = 0 then 'Risk-On'
      when (select risk_off_count from counts) >= 3 and (select risk_on_count from counts) = 0 then 'Risk-Off'
      when (select risk_on_count from counts) > 0 and (select risk_off_count from counts) > 0 then 'Mixed'
      else 'Neutral'
    end,
    'risk_on_count', (select risk_on_count from counts),
    'risk_off_count', (select risk_off_count from counts),
    'factor_count', (select factor_count from counts),
    'symbols', coalesce((select jsonb_agg(row_to_json(latest)) from latest), '[]'::jsonb),
    'net_liquidity', (select row_to_json(net_liquidity_class) from net_liquidity_class)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_market_reference_snapshot(p_exchange text, p_cutoff timestamp with time zone)
 RETURNS TABLE(timestamp_utc timestamp with time zone, last_price numeric, open_interest numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with bybit_candidate as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and p_exchange = 'aggregated'
      and m.timestamp_utc <= p_cutoff
    order by m.timestamp_utc desc
    limit 1
  ),
  bybit_fallback as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and p_exchange = 'aggregated'
      and not exists (select 1 from bybit_candidate)
    order by m.timestamp_utc asc
    limit 1
  ),
  bybit_point as (
    select * from bybit_candidate
    union all
    select * from bybit_fallback
  ),
  aggregated as (
    select
      b.timestamp_utc,
      b.last_price,
      sum(oi.open_interest) as open_interest
    from bybit_point b
    cross join unnest(array['bybit','binance','okx','bitget','pionex']) as ex(exchange)
    left join lateral (
      select m.open_interest
      from market_snapshots m
      where m.exchange = ex.exchange
        and m.status = 'ok'
        and m.timestamp_utc <= b.timestamp_utc
        and m.timestamp_utc >= b.timestamp_utc - interval '15 minutes'
      order by m.timestamp_utc desc
      limit 1
    ) oi on true
    group by b.timestamp_utc, b.last_price
  ),
  non_aggregated_candidate as (
    select m.timestamp_utc, m.last_price, m.open_interest
    from market_snapshots m
    where m.status = 'ok' and m.timestamp_utc <= p_cutoff and m.exchange = p_exchange
      and p_exchange <> 'aggregated'
    order by m.timestamp_utc desc
    limit 1
  ),
  non_aggregated_fallback as (
    select m.timestamp_utc, m.last_price, m.open_interest
    from market_snapshots m
    where m.status = 'ok' and m.exchange = p_exchange and p_exchange <> 'aggregated'
      and not exists (select 1 from non_aggregated_candidate)
    order by m.timestamp_utc asc
    limit 1
  )
  select * from aggregated
  union all
  select * from non_aggregated_candidate
  union all
  select * from non_aggregated_fallback;
$function$;

CREATE OR REPLACE FUNCTION public.get_market_series(p_exchange text, p_since timestamp with time zone, p_max_points integer DEFAULT 500, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(timestamp_utc timestamp with time zone, last_price numeric, open_interest numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with bybit_pts as (
    select m.timestamp_utc, m.last_price
    from market_snapshots m
    where m.exchange = 'bybit' and m.status = 'ok' and m.timestamp_utc >= p_since
      and (p_until is null or m.timestamp_utc <= p_until)
      and p_exchange = 'aggregated'
  ),
  agg as (
    select
      b.timestamp_utc,
      b.last_price,
      sum(oi.open_interest) as open_interest
    from bybit_pts b
    cross join unnest(array['bybit','binance','okx','bitget','pionex']) as ex(exchange)
    left join lateral (
      select m.open_interest
      from market_snapshots m
      where m.exchange = ex.exchange
        and m.status = 'ok'
        and m.timestamp_utc <= b.timestamp_utc
        and m.timestamp_utc >= b.timestamp_utc - interval '15 minutes'
      order by m.timestamp_utc desc
      limit 1
    ) oi on true
    group by b.timestamp_utc, b.last_price
  ),
  grouped as (
    select agg.timestamp_utc, agg.last_price, agg.open_interest
    from agg
    where p_exchange = 'aggregated'

    union all

    select m.timestamp_utc, m.last_price, m.open_interest
    from market_snapshots m
    where m.status = 'ok' and m.timestamp_utc >= p_since
      and (p_until is null or m.timestamp_utc <= p_until)
      and m.exchange = p_exchange
      and p_exchange <> 'aggregated'
  ),
  base as (
    select
      grouped.timestamp_utc, grouped.last_price, grouped.open_interest,
      row_number() over (order by grouped.timestamp_utc asc) as rn,
      count(*) over () as total
    from grouped
  )
  select base.timestamp_utc, base.last_price, base.open_interest
  from base
  where total <= p_max_points
     or rn = 1 or rn = total
     or rn % greatest(1, ceil(total::numeric / p_max_points)::int) = 0
  order by base.timestamp_utc asc;
$function$;

CREATE OR REPLACE FUNCTION public.get_market_snapshot_exchange_first_seen()
 RETURNS TABLE(exchange text, first_seen timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select m.exchange, min(m.timestamp_utc) as first_seen
  from market_snapshots m
  where m.status = 'ok'
  group by m.exchange;
$function$;

CREATE OR REPLACE FUNCTION public.get_oi_change_by_exchange(p_since timestamp with time zone)
 RETURNS TABLE(exchange text, oi_change_pct numeric, current_oi numeric, reference_oi numeric, reference_timestamp_utc timestamp with time zone, current_timestamp_utc timestamp with time zone, has_full_history boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with exchanges as (
    select distinct m.exchange
    from market_snapshots m
    where m.status = 'ok' and m.open_interest is not null
  ),
  latest as (
    select e.exchange, l.open_interest as current_oi, l.timestamp_utc as current_ts
    from exchanges e
    left join lateral (
      select m.open_interest, m.timestamp_utc
      from market_snapshots m
      where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
      order by m.timestamp_utc desc
      limit 1
    ) l on true
  ),
  reference as (
    select e.exchange,
      coalesce(r.open_interest, rf.open_interest) as reference_oi,
      coalesce(r.timestamp_utc, rf.timestamp_utc) as reference_ts
    from exchanges e
    left join lateral (
      select m.open_interest, m.timestamp_utc
      from market_snapshots m
      where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
        and m.timestamp_utc <= p_since
      order by m.timestamp_utc desc
      limit 1
    ) r on true
    left join lateral (
      select m.open_interest, m.timestamp_utc
      from market_snapshots m
      where m.exchange = e.exchange and m.status = 'ok' and m.open_interest is not null
      order by m.timestamp_utc asc
      limit 1
    ) rf on true
  )
  select
    latest.exchange,
    case
      when reference.reference_oi is not null and reference.reference_oi <> 0
        then ((latest.current_oi - reference.reference_oi) / reference.reference_oi) * 100
      else null
    end as oi_change_pct,
    latest.current_oi,
    reference.reference_oi,
    reference.reference_ts,
    latest.current_ts,
    (reference.reference_ts is not null and reference.reference_ts <= p_since + interval '15 minutes') as has_full_history
  from latest
  left join reference using (exchange)
  order by latest.exchange;
$function$;

CREATE OR REPLACE FUNCTION public.get_options_iv_rank(p_min_history_days numeric DEFAULT 30, p_currency text DEFAULT 'BTC'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with hist as (
  select timestamp_utc, atm_iv
  from options_snapshots
  where status = 'ok' and currency = p_currency and atm_iv is not null
),
bounds as (
  select
    count(*) as sample_count,
    min(timestamp_utc) as earliest,
    max(timestamp_utc) as latest,
    min(atm_iv) as iv_min,
    max(atm_iv) as iv_max,
    extract(epoch from (max(timestamp_utc) - min(timestamp_utc))) / 86400.0 as history_days
  from hist
),
current as (
  select atm_iv as current_atm_iv
  from hist
  order by timestamp_utc desc
  limit 1
)
select jsonb_build_object(
  'current_atm_iv', c.current_atm_iv,
  'sample_count', b.sample_count,
  'history_days', round(b.history_days, 2),
  'min_history_days_required', p_min_history_days,
  'iv_min', b.iv_min,
  'iv_max', b.iv_max,
  'iv_rank',
    case
      when b.history_days >= p_min_history_days and b.iv_max is not null and b.iv_max <> b.iv_min
        then round(((c.current_atm_iv - b.iv_min) / (b.iv_max - b.iv_min)) * 100, 1)
      else null
    end,
  'status',
    case
      when b.sample_count is null or b.sample_count = 0 then 'unavailable'
      when b.history_days < p_min_history_days then 'insufficient_history'
      when b.iv_max = b.iv_min then 'flat_range'
      else 'ok'
    end
)
from bounds b, current c;
$function$;

CREATE OR REPLACE FUNCTION public.get_pivot_points()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_resampled_candles(p_symbol text, p_source_interval text, p_bucket_minutes integer, p_since timestamp with time zone, p_until timestamp with time zone)
 RETURNS TABLE(bucket_open timestamp with time zone, open numeric, high numeric, low numeric, close numeric, volume numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    date_bin(make_interval(mins => p_bucket_minutes), c.open_time, timestamptz '2000-01-01') as bucket_open,
    (array_agg(c.open order by c.open_time asc))[1] as open,
    max(c.high) as high,
    min(c.low) as low,
    (array_agg(c.close order by c.open_time desc))[1] as close,
    sum(c.volume) as volume
  from candles c
  where c.exchange = 'binance'
    and c.symbol = p_symbol
    and c.interval = p_source_interval
    and c.open_time >= p_since
    and c.open_time < p_until
  group by 1
  order by 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_secret(secret_name text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'vault', 'public'
AS $function$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_short_term_range_check(p_exchange text DEFAULT 'binance'::text, p_symbol text DEFAULT 'BTCUSDT'::text, p_lookback_bars integer DEFAULT 16)
 RETURNS TABLE(as_of timestamp with time zone, "interval" text, lookback_bars integer, adx_14 numeric, bb_width numeric, is_ranging boolean)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_spot_pressure_series(p_since timestamp with time zone, p_max_points integer DEFAULT 300)
 RETURNS TABLE(timestamp_utc timestamp with time zone, last_price numeric, taker_buy_vol numeric, taker_sell_vol numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select
      m.timestamp_utc, m.last_price, m.taker_buy_vol, m.taker_sell_vol,
      row_number() over (order by m.timestamp_utc asc) as rn,
      count(*) over () as total
    from spot_market_snapshots m
    where m.status = 'ok' and m.exchange = 'binance' and m.timestamp_utc >= p_since
  )
  select base.timestamp_utc, base.last_price, base.taker_buy_vol, base.taker_sell_vol
  from base
  where total <= p_max_points
     or rn = 1 or rn = total
     or rn % greatest(1, ceil(total::numeric / p_max_points)::int) = 0
  order by base.timestamp_utc asc;
$function$;

CREATE OR REPLACE FUNCTION public.get_spot_pressure_summary(p_since timestamp with time zone)
 RETURNS TABLE(candle_count bigint, sum_taker_buy_vol numeric, sum_taker_sell_vol numeric, sum_taker_buy_quote_vol numeric, sum_taker_sell_quote_vol numeric, first_price numeric, last_price numeric, latest_timestamp_utc timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    count(*) as candle_count,
    sum(m.taker_buy_vol) as sum_taker_buy_vol,
    sum(m.taker_sell_vol) as sum_taker_sell_vol,
    sum(m.taker_buy_quote_vol) as sum_taker_buy_quote_vol,
    sum(m.taker_sell_quote_vol) as sum_taker_sell_quote_vol,
    (array_agg(m.open_price order by m.timestamp_utc asc))[1] as first_price,
    (array_agg(m.last_price order by m.timestamp_utc desc))[1] as last_price,
    max(m.timestamp_utc) as latest_timestamp_utc
  from spot_market_snapshots m
  where m.status = 'ok' and m.exchange = 'binance' and m.timestamp_utc >= p_since
  having count(*) > 0;
$function$;

CREATE OR REPLACE FUNCTION public.get_spot_volume_profile(p_since timestamp with time zone, p_price_bucket_usd numeric DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with buckets as (
    select
      round(price_bucket / p_price_bucket_usd) * p_price_bucket_usd as price_bucket,
      sum(buy_volume) as buy_volume,
      sum(sell_volume) as sell_volume,
      sum(trade_count) as trade_count
    from spot_volume_buckets
    where bucket_time_utc >= p_since
      and exchange = 'binance' and symbol = 'BTCUSDT'
    group by 1
    order by 1
  )
  select jsonb_build_object(
    'price_buckets', coalesce((select jsonb_agg(row_to_json(buckets)) from buckets), '[]'::jsonb),
    'total_buy_volume', coalesce((select sum(buy_volume) from buckets), 0),
    'total_sell_volume', coalesce((select sum(sell_volume) from buckets), 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_vwap_since(p_anchor_utc timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select sum((high + low + close) / 3.0 * volume) / nullif(sum(volume), 0)
  from candles
  where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h'
    and open_time >= p_anchor_utc;
$function$;

CREATE OR REPLACE FUNCTION public.pivot_calc(h double precision, l double precision, c double precision)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select jsonb_build_object(
    'pp', (h + l + c) / 3.0,
    'r1', 2.0 * ((h + l + c) / 3.0) - l,
    'r2', ((h + l + c) / 3.0) + (h - l),
    'r3', h + 2.0 * (((h + l + c) / 3.0) - l),
    's1', 2.0 * ((h + l + c) / 3.0) - h,
    's2', ((h + l + c) / 3.0) - (h - l),
    's3', l - 2.0 * (h - ((h + l + c) / 3.0))
  );
$function$;

CREATE OR REPLACE FUNCTION public.recompute_market_structure_causal(p_interval text, p_symbol text DEFAULT 'BTCUSDT'::text, p_lookback integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  h double precision[];
  l double precision[];
  t timestamptz[];
  n integer;
  raw_high boolean[];
  raw_low boolean[];
  trend_arr text[];
  bos_arr boolean[];
  bos_dir text[];
  choch_arr boolean[];
  choch_dir text[];
  i integer;
  j integer;
  k integer;
  is_high boolean;
  is_low boolean;
  last_high double precision;
  last_low double precision;
  trend text := 'ranging';
  st text;
  changed integer;
begin
  select array_agg(c.high::double precision order by c.open_time),
         array_agg(c.low::double precision order by c.open_time),
         array_agg(c.open_time order by c.open_time)
    into h, l, t
    from candles c
   where c.exchange = 'binance' and c.symbol = p_symbol and c.interval = p_interval;
  n := coalesce(array_length(h, 1), 0);
  if n = 0 then
    return 0;
  end if;

  raw_high := array_fill(false, array[n]);
  raw_low := array_fill(false, array[n]);
  for i in (p_lookback + 1)..(n - p_lookback) loop
    is_high := true;
    is_low := true;
    for k in (i - p_lookback)..(i + p_lookback) loop
      continue when k = i;
      if h[k] >= h[i] then is_high := false; end if;
      if l[k] <= l[i] then is_low := false; end if;
    end loop;
    raw_high[i] := is_high;
    raw_low[i] := is_low;
  end loop;

  trend_arr := array_fill('ranging'::text, array[n]);
  bos_arr := array_fill(false, array[n]);
  bos_dir := array_fill(null::text, array[n]);
  choch_arr := array_fill(false, array[n]);
  choch_dir := array_fill(null::text, array[n]);

  for i in 1..n loop
    j := i - p_lookback;
    st := null;
    if j >= 1 then
      if raw_high[j] then
        if last_high is not null then
          st := case when h[j] > last_high then 'HH' else 'LH' end;
        end if;
        last_high := h[j];
      elsif raw_low[j] then
        if last_low is not null then
          st := case when l[j] > last_low then 'HL' else 'LL' end;
        end if;
        last_low := l[j];
      end if;
    end if;

    if st in ('HH', 'HL') then trend := 'bullish';
    elsif st in ('LH', 'LL') then trend := 'bearish';
    end if;

    if trend = 'bullish' then
      if last_low is not null and l[i] < last_low then
        choch_arr[i] := true; choch_dir[i] := 'bearish'; trend := 'bearish';
      elsif last_high is not null and h[i] > last_high then
        bos_arr[i] := true; bos_dir[i] := 'bullish';
      end if;
    elsif trend = 'bearish' then
      if last_high is not null and h[i] > last_high then
        choch_arr[i] := true; choch_dir[i] := 'bullish'; trend := 'bullish';
      elsif last_low is not null and l[i] < last_low then
        bos_arr[i] := true; bos_dir[i] := 'bearish';
      end if;
    end if;

    trend_arr[i] := trend;
  end loop;

  update market_features mf
     set structure_trend = x.trend,
         bos = x.bos,
         bos_direction = x.bos_direction,
         choch = x.choch,
         choch_direction = x.choch_direction
    from unnest(t, trend_arr, bos_arr, bos_dir, choch_arr, choch_dir)
         as x(open_time, trend, bos, bos_direction, choch, choch_direction)
   where mf.symbol = p_symbol
     and mf.interval = p_interval
     and mf.candle_open_time = x.open_time
     and (mf.structure_trend is distinct from x.trend
          or mf.bos is distinct from x.bos
          or mf.bos_direction is distinct from x.bos_direction
          or mf.choch is distinct from x.choch
          or mf.choch_direction is distinct from x.choch_direction);
  get diagnostics changed = row_count;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.redundancy_aware_v1_signal_state(p_factors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with domain_map(factor_name, domain) as (
    values
      ('structure', 'trend_composite'), ('vwap_position', 'trend_composite'),
      ('momentum', 'trend_composite'), ('trend_strength', 'trend_composite'), ('trend_regime', 'trend_composite'),
      ('cvd', 'trend_composite'),
      ('oi_price', 'derivatives_leverage'), ('positioning', 'derivatives_leverage'),
      ('funding', 'derivatives_leverage'), ('basis', 'derivatives_leverage'),
      ('options', 'options'), ('macro', 'macro_liquidity'), ('sentiment', 'sentiment')
  ),
  factor_values as (
    select dm.factor_name, dm.domain, nullif(p_factors -> dm.factor_name ->> 'value', '')::numeric as value
    from domain_map dm
  ),
  domain_agg as (
    select domain, avg(value) as domain_score, count(value) as factors_with_data, count(*) as factors_total
    from factor_values group by domain
  ),
  domain_with_data as (
    select * from domain_agg where domain_score is not null
  ),
  factor_coverage as (
    select count(*) filter (where value is not null) as factors_with_data, count(*) as factors_total
    from factor_values
  ),
  overall as (
    select
      count(*) as domains_with_data,
      (select count(distinct domain) from domain_map) as domains_total,
      coalesce(sum(domain_score), 0) as weighted_score,
      count(*) filter (where domain_score > 0) as positive_domains,
      count(*) filter (where domain_score < 0) as negative_domains,
      (select factors_with_data from factor_coverage) as factors_with_data,
      (select factors_total from factor_coverage) as factors_total
    from domain_with_data
  )
  select jsonb_build_object(
    'domain_scores', (
      select coalesce(jsonb_object_agg(domain, jsonb_build_object(
        'score', round(domain_score, 4), 'factors_with_data', factors_with_data, 'factors_total', factors_total
      )), '{}'::jsonb)
      from domain_agg
    ),
    'domain_coverage_pct', case when o.domains_total > 0 then round(100.0 * o.domains_with_data / o.domains_total, 1) else null end,
    'factor_coverage_pct', round(100.0 * o.factors_with_data / nullif(o.factors_total,0), 1),
    'weighted_score', round(o.weighted_score, 4),
    'overall_state',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 'INSUFFICIENT_DATA'
        when o.weighted_score >= 0.5 then 'BULLISH'
        when o.weighted_score <= -0.5 then 'BEARISH'
        when o.positive_domains > 0 and o.negative_domains > 0 then 'MIXED'
        else 'NEUTRAL'
      end,
    'confidence',
      case
        when o.factors_total = 0 or o.factors_with_data = 0 or (o.factors_with_data::numeric / o.factors_total) < 0.4 then 0
        else round((o.factors_with_data::numeric / o.factors_total) * (abs(o.weighted_score) / o.domains_with_data) * 100)
      end,
    'architecture_version', 'redundancy_aware_v1',
    'note', 'Model D -- 6 Faktoren zu einer Domain trend_composite zusammengefasst (TRAIN-Korrelation >=0.55). Schwellenwert 0.5 fest gewaehlt (aus erster Prinzipien, nicht aus Validation zurueckgerechnet), nach Korrektur eines unerreichbaren Schwellenwerts (1.07 > max. moeglicher Score 1.0 bei strukturell nur einer aktiven Domain in diesem Datensatz).'
  )
  from overall o;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_data_quality()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- === A) Futures Market Snapshots (Binance/Bybit/OKX/Bitget) ===========
  with sources as (select unnest(array['binance','bybit','okx','bitget']) as exchange),
  all_time as (
    select exchange, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from market_snapshots where symbol = 'BTCUSDT' group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where last_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from market_snapshots where symbol = 'BTCUSDT' and timestamp_utc >= now() - interval '6 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'futures_market_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from market_snapshots where exchange = s.exchange and symbol = 'BTCUSDT'),
    coalesce(r.error_count, 0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === B) Spot Market Snapshots (Binance) ================================
  with all_time as (
    select max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from spot_market_snapshots where exchange = 'binance'
  ),
  recent as (
    select count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where last_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from spot_market_snapshots where exchange = 'binance' and timestamp_utc >= now() - interval '6 hours'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'binance', 'spot_market_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from spot_market_snapshots where exchange = 'binance'),
    coalesce(r.error_count, 0), ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === C) Candles (Binance, je Intervall) -- keine Status-Spalte =========
  with cfg(cinterval, expected_seconds) as (values ('1h',3600), ('4h',14400), ('1d',86400)),
  all_time as (
    select interval as cinterval, max(close_time) as data_timestamp
    from candles where symbol = 'BTCUSDT' and exchange = 'binance' group by interval
  ),
  recent as (
    select c.interval as cinterval, count(*) as total_count, count(*) filter (where c.close is null) as missing_count
    from candles c join cfg on cfg.cinterval = c.interval
    where c.symbol = 'BTCUSDT' and c.exchange = 'binance' and c.close_time >= now() - (cfg.expected_seconds * 10 || ' seconds')::interval
    group by c.interval
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'binance', 'candles_' || cfg.cinterval, 'BTCUSDT', at.data_timestamp, at.data_timestamp, cfg.expected_seconds, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from candles where symbol = 'BTCUSDT' and exchange = 'binance' and interval = cfg.cinterval),
    0, ev.quality_score, now()
  from cfg
  left join all_time at on at.cinterval = cfg.cinterval
  left join recent r on r.cinterval = cfg.cinterval
  cross join lateral public._dq_evaluate(
    at.data_timestamp, at.data_timestamp, cfg.expected_seconds, 3,
    null,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === D) Market Features (Binance, je Intervall) -- keine Status-Spalte,
  -- Vollstaendigkeit ueber rsi_14 geprueft (null = zu wenig Vorlauf-Historie) ==
  with cfg(cinterval, expected_seconds) as (values ('1h',3600), ('4h',14400), ('1d',86400)),
  all_time as (
    select interval as cinterval, max(candle_open_time) as data_timestamp
    from market_features where symbol = 'BTCUSDT' group by interval
  ),
  recent as (
    select mf.interval as cinterval, count(*) as total_count, count(*) filter (where mf.rsi_14 is null) as missing_count
    from market_features mf join cfg on cfg.cinterval = mf.interval
    where mf.symbol = 'BTCUSDT' and mf.candle_open_time >= now() - (cfg.expected_seconds * 10 || ' seconds')::interval
    group by mf.interval
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'nexus-atlas-engine', 'market_features_' || cfg.cinterval, 'BTCUSDT', at.data_timestamp, at.data_timestamp, cfg.expected_seconds, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from market_features where symbol = 'BTCUSDT' and interval = cfg.cinterval),
    0, ev.quality_score, now()
  from cfg
  left join all_time at on at.cinterval = cfg.cinterval
  left join recent r on r.cinterval = cfg.cinterval
  cross join lateral public._dq_evaluate(
    at.data_timestamp, at.data_timestamp, cfg.expected_seconds, 3,
    null,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === E) Options (Deribit) ==============================================
  with all_time as (
    select max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from options_snapshots
  ),
  recent as (
    select count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where atm_iv is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from options_snapshots where timestamp_utc >= now() - interval '6 hours'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'deribit', 'options_snapshot', 'BTC', at.last_success_at, at.data_timestamp, 1800, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from options_snapshots), coalesce(r.error_count,0), ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 1800, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === F) Macro (Yahoo + FRED, je Symbol -- je eigene Toleranz) ==========
  with cfg(symbol, source, expected_seconds, mult) as (
    values
      ('^GSPC','yahoo_finance',1800,100), ('^IXIC','yahoo_finance',1800,100), ('^VIX','yahoo_finance',1800,100),
      ('DX-Y.NYB','yahoo_finance',1800,100), ('^TNX','yahoo_finance',1800,100),
      ('DGS2','fred',86400,5), ('DFF','fred',86400,5), ('RRPONTSYD','fred',86400,5),
      ('WALCL','fred',604800,3), ('WTREGEN','fred',604800,3),
      ('M2SL','fred',2629800,2), ('CPIAUCSL','fred',2629800,2), ('PCEPI','fred',2629800,2), ('PAYEMS','fred',2629800,2)
  ),
  all_time as (
    select symbol, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from macro_snapshots group by symbol
  ),
  recent as (
    select symbol, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where last_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from macro_snapshots where timestamp_utc >= now() - interval '14 days' group by symbol
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    cfg.source, 'macro_series', cfg.symbol, at.last_success_at, at.data_timestamp, cfg.expected_seconds, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from macro_snapshots where symbol = cfg.symbol), coalesce(r.error_count,0), ev.quality_score, now()
  from cfg
  left join all_time at on at.symbol = cfg.symbol
  left join recent r on r.symbol = cfg.symbol
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, cfg.expected_seconds, cfg.mult,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === G) On-Chain (BGeometrics, je Metrik -- Tabelle hat schon "metric") ==
  with all_time as (
    select metric, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from onchain_snapshots group by metric
  ),
  recent as (
    select metric, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where value is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from onchain_snapshots where timestamp_utc >= now() - interval '14 days' group by metric
  ),
  cfg as (
    select unnest(array['sopr','mvrv','realized-price','lth-net-position-change-btc','sth-net-position-change-btc','miner-net-flow','stablecoin-supply','balance-addr-10K-BTC']) as metric
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'bgeometrics', cfg.metric, 'BTC', at.last_success_at, at.data_timestamp, 86400, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from onchain_snapshots where metric = cfg.metric), coalesce(r.error_count,0), ev.quality_score, now()
  from cfg
  left join all_time at on at.metric = cfg.metric
  left join recent r on r.metric = cfg.metric
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 86400, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === H) Sentiment (alternative.me) ======================================
  with all_time as (
    select max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from sentiment_snapshots
  ),
  recent as (
    select count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where value is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from sentiment_snapshots where timestamp_utc >= now() - interval '14 days'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'alternative.me', 'fear_greed_index', 'BTC', at.last_success_at, at.data_timestamp, 86400, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from sentiment_snapshots), coalesce(r.error_count,0), ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 86400, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === I) ETF Flows (SoSoValue/Farside) -- keine Status-Spalte ============
  with all_time as (select max(created_at) as data_timestamp from etf_flows),
  recent as (
    select count(*) as total_count, count(*) filter (where total_flow_usd_m is null) as missing_count
    from etf_flows where created_at >= now() - interval '14 days'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'sosovalue', 'etf_net_flow', 'BTC', at.data_timestamp, at.data_timestamp, 86400, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from etf_flows), 0, ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.data_timestamp, at.data_timestamp, 86400, 4,
    null,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === J) Positioning Snapshots (Binance/Bybit/OKX/Bitget) ===============
  with sources as (select unnest(array['binance','bybit','okx','bitget']) as exchange),
  all_time as (
    select exchange, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from positioning_snapshots group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where global_account_long_short_ratio is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from positioning_snapshots where timestamp_utc >= now() - interval '6 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'positioning_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from positioning_snapshots where exchange = s.exchange), coalesce(r.error_count,0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === K) Liquidation Events (Binance/Bybit) -- ereignisgetrieben, siehe
  -- Kommentar oben: grosszuegige Stale-Toleranz (6h), da "keine Zeile" ein
  -- legitimer Ruhezustand sein kann. ============================
  with sources as (select unnest(array['binance','bybit']) as exchange),
  all_time as (
    select exchange, max(event_time_utc) filter (where status = 'ok') as last_success_at, max(event_time_utc) as data_timestamp
    from liquidation_events group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count
    from liquidation_events where event_time_utc >= now() - interval '24 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'liquidation_events', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when at.last_success_at is null then 'error' else 'ok' end,
    null,
    'not_applicable',
    (select count(*) from liquidation_events where exchange = s.exchange), coalesce(r.error_count,0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 72,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    null, false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === L) Orderbook Snapshots (Binance/Bybit/OKX) =========================
  with sources as (select unnest(array['binance','bybit','okx']) as exchange),
  all_time as (
    select exchange, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from orderbook_snapshots group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where mid_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from orderbook_snapshots where timestamp_utc >= now() - interval '6 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'orderbook_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from orderbook_snapshots where exchange = s.exchange), coalesce(r.error_count,0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === M) News Ingestion -- ereignisgetrieben, grosszuegige Toleranz.
  -- symbol='ALL' (statt NULL, s. Migrationskommentar oben) =====
  with all_time as (select max(created_at) as data_timestamp from news_events),
  recent as (select count(*) as total_count from news_events where created_at >= now() - interval '24 hours')
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'nexus-news-collector', 'news_ingestion', 'ALL', at.data_timestamp, at.data_timestamp, 900, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    null, 'not_applicable',
    (select count(*) from news_events), 0, ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(at.data_timestamp, at.data_timestamp, 900, 48, null, null, false) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_market_state_matrix(p_symbol text DEFAULT 'BTCUSDT'::text, p_interval text DEFAULT '1h'::text, p_exchange text DEFAULT 'binance'::text, p_lookback interval DEFAULT '2 days'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
  v_since timestamptz;
begin
  -- Nur die juengsten Zeilen neu schreiben; p_lookback = null -> alles.
  if p_lookback is not null then
    select max(m.timestamp_utc) - p_lookback into v_since
    from public.market_state_matrix m
    where m.symbol = p_symbol and m.interval = p_interval;
  end if;

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
  where v_since is null or s.timestamp_utc >= v_since
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
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_bh_fdr(p_pool text, p_alpha numeric DEFAULT 0.05)
 RETURNS TABLE(id bigint, cell_type text, signal_a text, signal_b text, direction text, window_start timestamp with time zone, window_end timestamp with time zone, n1 integer, n2 integer, hit_rate1_pct numeric, hit_rate2_pct numeric, raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean)
 LANGUAGE sql
 STABLE
AS $function$
  with tested as (
    select s.* from research_confluence_signal_stats s
    where s.pool = p_pool and s.min_n_met and s.raw_p_value is not null
  ),
  ranked as (
    select *, rank() over (order by raw_p_value) as rnk, count(*) over () as m
    from tested
  )
  select
    id, cell_type, signal_a, signal_b, direction, window_start, window_end,
    n1, n2, hit_rate1_pct, hit_rate2_pct,
    round(raw_p_value,4), rnk::int,
    round((rnk::numeric/m)*p_alpha, 4),
    raw_p_value <= (rnk::numeric/m)*p_alpha
  from ranked
  order by raw_p_value;
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_extend_activation()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Struktur 15m (Leading, Toleranz 4h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 15m', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 15m');

  -- Struktur 1h (Leading, Toleranz 4h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 1h', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 1h');

  -- Struktur 4h (Leading, Toleranz 8h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 4h', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '8 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '4h' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 4h');

  -- Struktur 1d (Leading, Toleranz 30h)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Struktur 1d', c.direction, c.outcome,
    coalesce((
      select m.structure_trend = (case when c.direction = 'LONG' then 'bullish' else 'bearish' end)
             and c.entry_time - m.candle_open_time <= interval '30 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1d' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Struktur 1d');

  -- MTF-Alignment (Leading, striktes 3-Way-Match 1h/4h/1d, je eigene Toleranz)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'MTF-Alignment', c.direction, c.outcome,
    coalesce((
      select
        (m1h.structure_trend = tgt and c.entry_time - m1h.candle_open_time <= interval '4 hours')
        and (m4h.structure_trend = tgt and c.entry_time - m4h.candle_open_time <= interval '8 hours')
        and (m1d.structure_trend = tgt and c.entry_time - m1d.candle_open_time <= interval '30 hours')
      from
        (select case when c.direction = 'LONG' then 'bullish' else 'bearish' end as tgt) t,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1h' and candle_open_time <= c.entry_time
                 order by candle_open_time desc limit 1) m1h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='4h' and candle_open_time <= c.entry_time
                 order by candle_open_time desc limit 1) m4h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1d' and candle_open_time <= c.entry_time
                 order by candle_open_time desc limit 1) m1d
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'MTF-Alignment');

  -- CVD-Richtung (Leading, Toleranz 4h, 15m)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'CVD-Richtung', c.direction, c.outcome,
    coalesce((
      select m.cvd_trend = (case when c.direction = 'LONG' then 'rising' else 'falling' end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'CVD-Richtung');

  -- Trendstaerke (ADX+DI) (Leading, Toleranz 4h, 15m; ADX>=20 + DI-Richtung)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Trendstaerke (ADX+DI)', c.direction, c.outcome,
    coalesce((
      select m.adx_14 >= 20
             and (case when c.direction = 'LONG' then m.plus_di > m.minus_di else m.minus_di > m.plus_di end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Trendstaerke (ADX+DI)');

  -- Trend-Regime (EMA50/200) (Leading, Toleranz 4h, 15m)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Trend-Regime (EMA50/200)', c.direction, c.outcome,
    coalesce((
      select (case when c.direction = 'LONG' then m.ema_50 > m.ema_200 else m.ema_50 < m.ema_200 end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Trend-Regime (EMA50/200)');

  -- VWAP-Position (Leading, Toleranz 4h, 15m)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'VWAP-Position', c.direction, c.outcome,
    coalesce((
      select (case when c.direction = 'LONG' then m.close_price > m.vwap else m.close_price < m.vwap end)
             and c.entry_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= c.entry_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'VWAP-Position');

  -- Fear & Greed (Leading, Toleranz 30h, kontrarisch: Extreme Fear->LONG, Extreme Greed->SHORT)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Fear & Greed', c.direction, c.outcome,
    coalesce((
      select s.classification = (case when c.direction = 'LONG' then 'Extreme Fear' else 'Extreme Greed' end)
             and c.entry_time - s.timestamp_utc <= interval '30 hours'
      from sentiment_snapshots s
      where s.source = 'alternative.me' and s.timestamp_utc <= c.entry_time
      order by s.timestamp_utc desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Fear & Greed');

  -- Makro-Regime (Leading, Risk-On->LONG, Risk-Off->SHORT)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Makro-Regime', c.direction, c.outcome,
    coalesce(
      (get_macro_regime_asof(c.entry_time) ->> 'regime') =
      (case when c.direction = 'LONG' then 'Risk-On' else 'Risk-Off' end),
      false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Makro-Regime');

  -- Orderbuch-Imbalance (Leading, Toleranz 4h; Schwelle 0.08 Betrag)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Orderbuch-Imbalance', c.direction, c.outcome,
    coalesce((
      select (case when c.direction = 'LONG' then o.depth_imbalance > 0.08 else o.depth_imbalance < -0.08 end)
             and c.entry_time - o.timestamp_utc <= interval '4 hours'
      from orderbook_snapshots o
      where o.exchange = 'binance' and o.symbol = 'BTCUSDT' and o.timestamp_utc <= c.entry_time
      order by o.timestamp_utc desc limit 1
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Orderbuch-Imbalance');

  -- Momentum-Faktor (RSI+MACD) (Confirming: Entry bis Preis+0.25%-Marge, RSI/MACD in Trendrichtung
  -- irgendwann im Fenster aktiv; ~92% Rekonstruktions-Genauigkeit ggue. historischer Klassifizierung,
  -- siehe Doku-Nachtrag -- kleines Genauigkeits-Risiko bewusst in Kauf genommen, da Signal bereits
  -- gesichert BH-FDR-signifikant ist und neue Zeilen die Gesamtkraft kaum veraendern)
  insert into research_confluence_signal_activation (setup_id, signal_a, direction, outcome, is_active)
  select c.id, 'Momentum-Faktor (RSI+MACD)', c.direction, c.outcome,
    coalesce((
      select exists (
        select 1 from market_features m
        where m.symbol = 'BTCUSDT' and m.interval = '15m'
          and m.candle_open_time >= c.entry_time and m.candle_open_time <= t.t_confirm
          and (case when c.direction = 'LONG' then m.rsi_14 > 50 and m.macd_histogram > 0
                    else m.rsi_14 < 50 and m.macd_histogram < 0 end)
      )
      from lateral (
        select min(k.open_time) as t_confirm from candles k
        where k.exchange = 'binance' and k.symbol = 'BTCUSDT' and k.interval = '15m'
          and k.open_time > c.entry_time and k.open_time <= c.resolution_time
          and (case when c.direction = 'LONG' then k.high >= c.entry_price * 1.0025
                    else k.low <= c.entry_price * 0.9975 end)
      ) t
      where t.t_confirm is not null
    ), false)
  from research_swing_setup_chain_results c
  where c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5 and c.retrace_pct = 0.25 and c.vertical_bars = 192
    and not exists (select 1 from research_confluence_signal_activation r where r.setup_id = c.id and r.signal_a = 'Momentum-Faktor (RSI+MACD)');
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_extend_chain()
 RETURNS TABLE(out_direction text, inserted_count integer)
 LANGUAGE plpgsql
AS $function$
declare
  v_dir text;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
begin
  foreach v_dir in array array['LONG','SHORT'] loop
    select coalesce(max(c.resolution_time), '2024-09-11'::timestamptz) + interval '15 minutes'
      into v_start
    from research_swing_setup_chain_results c
    where c.direction = v_dir and c.interval = '15m' and c.tp_pct = 1.75 and c.sl_pct = 0.5
      and c.retrace_pct = 0.25 and c.vertical_bars = 192;

    select max(m.candle_open_time) into v_end
    from market_features m where m.symbol = 'BTCUSDT' and m.interval = '15m';

    insert into research_swing_setup_chain_results
      (interval, direction, tp_pct, sl_pct, retrace_pct, vertical_bars,
       signal_time, entry_time, entry_price, outcome, resolution_time, bars_to_resolution, mfe_pct)
    select '15m', v_dir, 1.75, 0.5, 0.25, 192,
           e.signal_time, e.entry_time, e.entry_price, e.outcome, e.resolution_time, e.bars_to_resolution, e.mfe_pct
    from research_swing_setup_chain_events('15m', v_dir, 1.75, 0.5, 0.25, 192, v_start, v_end) e;

    get diagnostics v_count = row_count;
    out_direction := v_dir;
    inserted_count := v_count;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_refresh_stats()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_signals text[] := array[
    'CVD-Richtung', 'Fear & Greed', 'Makro-Regime', 'Momentum-Faktor (RSI+MACD)',
    'MTF-Alignment', 'Orderbuch-Imbalance', 'Struktur 15m', 'Struktur 1h', 'Struktur 4h',
    'Struktur 1d', 'Trend-Regime (EMA50/200)', 'Trendstaerke (ADX+DI)', 'VWAP-Position'
  ];
begin
  delete from research_confluence_signal_stats
  where pool = 'main' and cell_type = 'signal' and signal_a = any(v_signals);

  insert into research_confluence_signal_stats
    (cell_type, pool, signal_a, signal_b, direction, window_start, window_end, n1, x1, n2, x2, min_n_met)
  select
    'signal', 'main', r.signal_a, null, r.direction,
    min(c.entry_time), max(c.entry_time),
    count(*) filter (where r.is_active),
    count(*) filter (where r.is_active and r.outcome = 'TRAIL_EXIT'),
    count(*) filter (where not r.is_active),
    count(*) filter (where not r.is_active and r.outcome = 'TRAIL_EXIT'),
    false
  from research_confluence_signal_activation r
  join research_swing_setup_chain_results c on c.id = r.setup_id
  where r.signal_a = any(v_signals)
  group by r.signal_a, r.direction;

  delete from research_confluence_signal_stats
  where pool = 'main' and cell_type = 'pair_a' and signal_a = any(v_signals) and signal_b = any(v_signals);

  insert into research_confluence_signal_stats
    (cell_type, pool, signal_a, signal_b, direction, window_start, window_end, n1, x1, n2, x2, min_n_met)
  select
    'pair_a', 'main', a.signal_a, b.signal_a, a.direction,
    min(c.entry_time), max(c.entry_time),
    count(*) filter (where a.is_active and b.is_active),
    count(*) filter (where a.is_active and b.is_active and a.outcome = 'TRAIL_EXIT'),
    count(*) filter (where not (a.is_active and b.is_active)),
    count(*) filter (where not (a.is_active and b.is_active) and a.outcome = 'TRAIL_EXIT'),
    false
  from research_confluence_signal_activation a
  join research_confluence_signal_activation b
    on b.setup_id = a.setup_id and b.direction = a.direction and b.signal_a > a.signal_a
  join research_swing_setup_chain_results c on c.id = a.setup_id
  where a.signal_a = any(v_signals) and b.signal_a = any(v_signals)
  group by a.signal_a, b.signal_a, a.direction;

  update research_confluence_signal_stats s
  set hit_rate1_pct = case when s.n1 > 0 then round(100.0 * s.x1 / s.n1, 1) else null end,
      hit_rate2_pct = case when s.n2 > 0 then round(100.0 * s.x2 / s.n2, 1) else null end,
      wilson1_lower = w1.lower, wilson1_upper = w1.upper,
      wilson2_lower = w2.lower, wilson2_upper = w2.upper,
      z_score = zt.z_score, raw_p_value = zt.raw_p_value,
      min_n_met = (s.n1 >= 10 and s.n2 >= 10),
      raw_significant = (s.n1 >= 10 and s.n2 >= 10 and zt.raw_p_value is not null and zt.raw_p_value < 0.05),
      computed_at = now()
  from research_confluence_signal_stats s2
  cross join lateral research_wilson_ci(s2.x1, s2.n1) w1
  cross join lateral research_wilson_ci(s2.x2, s2.n2) w2
  cross join lateral research_two_proportion_ztest(s2.x1, s2.n1, s2.x2, s2.n2) zt
  where s.id = s2.id
    and s2.pool = 'main'
    and ((s2.cell_type = 'signal' and s2.signal_a = any(v_signals))
         or (s2.cell_type = 'pair_a' and s2.signal_a = any(v_signals) and s2.signal_b = any(v_signals)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_score(p_direction text, p_trend_count integer, p_fear_greed_active boolean, p_makro_active boolean, p_orderbuch_active boolean, p_momentum_state text DEFAULT 'unknown'::text)
 RETURNS TABLE(probability numeric, tier text, logit numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_trend_level text;
  v_logit numeric;
  v_tiers research_confluence_score_tiers%rowtype;
begin
  v_trend_level := case when p_trend_count = 0 then '0' when p_trend_count = 1 then '1'
                        when p_trend_count in (2,3) then '2-3' else '4+' end;

  select * into v_tiers from research_confluence_score_tiers t where t.direction = p_direction;

  select v_tiers.base_logit
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'trend' and w.level = v_trend_level), 0)
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'fear_greed' and w.level = p_fear_greed_active::text), 0)
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'makro' and w.level = p_makro_active::text), 0)
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'orderbuch' and w.level = p_orderbuch_active::text), 0)
    + case when p_momentum_state in ('true','false') then
        coalesce((select w.woe from research_confluence_score_woe w
          where w.direction = p_direction and w.factor = 'momentum' and w.level = p_momentum_state), 0)
      else 0 end
  into v_logit;

  logit := v_logit;
  probability := round(100.0 / (1.0 + exp(-v_logit)), 1);
  tier := case
    when v_logit <= ln(v_tiers.tier_low_max / (1 - v_tiers.tier_low_max)) then 'Niedrig'
    when v_logit <= ln(v_tiers.tier_mid_max / (1 - v_tiers.tier_mid_max)) then 'Mittel'
    else 'Hoch'
  end;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_score_live()
 RETURNS TABLE(direction text, trend_count integer, trend_signals jsonb, fear_greed_active boolean, fear_greed_value numeric, fear_greed_classification text, makro_active boolean, makro_regime text, orderbuch_active boolean, orderbuch_imbalance numeric, probability numeric, tier text, data_asof timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_dir text;
  v_15m record;
  v_1h record;
  v_4h record;
  v_1d record;
  v_ob record;
  v_fg record;
  v_makro jsonb;

  -- Boolesche Einzelkomponenten je Richtung (dieselbe Logik wie vorher,
  -- jetzt in benannten Variablen statt nur in der Summe verschwindend).
  v_s15_long boolean;
  v_s1h_long boolean;
  v_s4h_long boolean;
  v_s1d_long boolean;
  v_mtf_long boolean;
  v_cvd_long boolean;
  v_adx_long boolean;
  v_ema_long boolean;
  v_vwap_long boolean;

  v_s15_short boolean;
  v_s1h_short boolean;
  v_s4h_short boolean;
  v_s1d_short boolean;
  v_mtf_short boolean;
  v_cvd_short boolean;
  v_adx_short boolean;
  v_ema_short boolean;
  v_vwap_short boolean;

  v_long_count integer;
  v_short_count integer;
  v_trend_signals_long jsonb;
  v_trend_signals_short jsonb;

  v_fear_greed_active boolean;
  v_makro_active_long boolean;
  v_makro_active_short boolean;
  v_ob_active_long boolean;
  v_ob_active_short boolean;
  v_oldest timestamptz;
  v_prob numeric;
  v_tier text;
begin
  select structure_trend, cvd_trend, adx_14, plus_di, minus_di, ema_50, ema_200, close_price, vwap, candle_open_time
  into v_15m
  from market_features where symbol='BTCUSDT' and interval='15m' order by candle_open_time desc limit 1;

  select structure_trend, candle_open_time into v_1h
  from market_features where symbol='BTCUSDT' and interval='1h' order by candle_open_time desc limit 1;

  select structure_trend, candle_open_time into v_4h
  from market_features where symbol='BTCUSDT' and interval='4h' order by candle_open_time desc limit 1;

  select structure_trend, candle_open_time into v_1d
  from market_features where symbol='BTCUSDT' and interval='1d' order by candle_open_time desc limit 1;

  select depth_imbalance, timestamp_utc into v_ob
  from orderbook_snapshots where exchange='binance' and symbol='BTCUSDT' order by timestamp_utc desc limit 1;

  select value, classification, timestamp_utc into v_fg
  from sentiment_snapshots where source='alternative.me' order by timestamp_utc desc limit 1;

  select get_macro_regime() into v_makro;

  v_mtf_long := coalesce(v_1h.structure_trend = 'bullish' and now() - v_1h.candle_open_time <= interval '4 hours', false)
    and coalesce(v_4h.structure_trend = 'bullish' and now() - v_4h.candle_open_time <= interval '8 hours', false)
    and coalesce(v_1d.structure_trend = 'bullish' and now() - v_1d.candle_open_time <= interval '30 hours', false);
  v_mtf_short := coalesce(v_1h.structure_trend = 'bearish' and now() - v_1h.candle_open_time <= interval '4 hours', false)
    and coalesce(v_4h.structure_trend = 'bearish' and now() - v_4h.candle_open_time <= interval '8 hours', false)
    and coalesce(v_1d.structure_trend = 'bearish' and now() - v_1d.candle_open_time <= interval '30 hours', false);

  v_s15_long := coalesce(v_15m.structure_trend = 'bullish' and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_s1h_long := coalesce(v_1h.structure_trend = 'bullish' and now() - v_1h.candle_open_time <= interval '4 hours', false);
  v_s4h_long := coalesce(v_4h.structure_trend = 'bullish' and now() - v_4h.candle_open_time <= interval '8 hours', false);
  v_s1d_long := coalesce(v_1d.structure_trend = 'bullish' and now() - v_1d.candle_open_time <= interval '30 hours', false);
  v_cvd_long := coalesce(v_15m.cvd_trend = 'rising' and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_adx_long := coalesce(v_15m.adx_14 >= 20 and v_15m.plus_di > v_15m.minus_di and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_ema_long := coalesce(v_15m.ema_50 > v_15m.ema_200 and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_vwap_long := coalesce(v_15m.close_price > v_15m.vwap and now() - v_15m.candle_open_time <= interval '4 hours', false);

  v_s15_short := coalesce(v_15m.structure_trend = 'bearish' and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_s1h_short := coalesce(v_1h.structure_trend = 'bearish' and now() - v_1h.candle_open_time <= interval '4 hours', false);
  v_s4h_short := coalesce(v_4h.structure_trend = 'bearish' and now() - v_4h.candle_open_time <= interval '8 hours', false);
  v_s1d_short := coalesce(v_1d.structure_trend = 'bearish' and now() - v_1d.candle_open_time <= interval '30 hours', false);
  v_cvd_short := coalesce(v_15m.cvd_trend = 'falling' and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_adx_short := coalesce(v_15m.adx_14 >= 20 and v_15m.minus_di > v_15m.plus_di and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_ema_short := coalesce(v_15m.ema_50 < v_15m.ema_200 and now() - v_15m.candle_open_time <= interval '4 hours', false);
  v_vwap_short := coalesce(v_15m.close_price < v_15m.vwap and now() - v_15m.candle_open_time <= interval '4 hours', false);

  v_long_count := v_s15_long::int + v_s1h_long::int + v_s4h_long::int + v_s1d_long::int
    + v_mtf_long::int + v_cvd_long::int + v_adx_long::int + v_ema_long::int + v_vwap_long::int;
  v_short_count := v_s15_short::int + v_s1h_short::int + v_s4h_short::int + v_s1d_short::int
    + v_mtf_short::int + v_cvd_short::int + v_adx_short::int + v_ema_short::int + v_vwap_short::int;

  v_trend_signals_long := jsonb_build_array(
    jsonb_build_object('name', 'Struktur 15m', 'active', v_s15_long),
    jsonb_build_object('name', 'Struktur 1h', 'active', v_s1h_long),
    jsonb_build_object('name', 'Struktur 4h', 'active', v_s4h_long),
    jsonb_build_object('name', 'Struktur 1d', 'active', v_s1d_long),
    jsonb_build_object('name', 'MTF-Alignment', 'active', v_mtf_long),
    jsonb_build_object('name', 'CVD-Richtung', 'active', v_cvd_long),
    jsonb_build_object('name', 'Trendstaerke (ADX+DI)', 'active', v_adx_long),
    jsonb_build_object('name', 'Trend-Regime (EMA50/200)', 'active', v_ema_long),
    jsonb_build_object('name', 'VWAP-Position', 'active', v_vwap_long)
  );
  v_trend_signals_short := jsonb_build_array(
    jsonb_build_object('name', 'Struktur 15m', 'active', v_s15_short),
    jsonb_build_object('name', 'Struktur 1h', 'active', v_s1h_short),
    jsonb_build_object('name', 'Struktur 4h', 'active', v_s4h_short),
    jsonb_build_object('name', 'Struktur 1d', 'active', v_s1d_short),
    jsonb_build_object('name', 'MTF-Alignment', 'active', v_mtf_short),
    jsonb_build_object('name', 'CVD-Richtung', 'active', v_cvd_short),
    jsonb_build_object('name', 'Trendstaerke (ADX+DI)', 'active', v_adx_short),
    jsonb_build_object('name', 'Trend-Regime (EMA50/200)', 'active', v_ema_short),
    jsonb_build_object('name', 'VWAP-Position', 'active', v_vwap_short)
  );

  v_makro_active_long := (v_makro ->> 'regime') = 'Risk-On';
  v_makro_active_short := (v_makro ->> 'regime') = 'Risk-Off';

  v_ob_active_long := coalesce(v_ob.depth_imbalance > 0.08 and now() - v_ob.timestamp_utc <= interval '4 hours', false);
  v_ob_active_short := coalesce(v_ob.depth_imbalance < -0.08 and now() - v_ob.timestamp_utc <= interval '4 hours', false);

  v_oldest := least(
    coalesce(v_15m.candle_open_time, now()),
    coalesce(v_fg.timestamp_utc, now()),
    coalesce(v_ob.timestamp_utc, now())
  );

  foreach v_dir in array array['LONG','SHORT'] loop
    direction := v_dir;
    trend_count := case when v_dir = 'LONG' then v_long_count else v_short_count end;
    trend_signals := case when v_dir = 'LONG' then v_trend_signals_long else v_trend_signals_short end;
    fear_greed_classification := v_fg.classification;
    fear_greed_value := v_fg.value;
    fear_greed_active := coalesce(v_fg.timestamp_utc is not null and now() - v_fg.timestamp_utc <= interval '30 hours', false)
      and (case when v_dir = 'LONG' then v_fg.classification = 'Extreme Fear' else v_fg.classification = 'Extreme Greed' end);
    makro_regime := v_makro ->> 'regime';
    makro_active := case when v_dir = 'LONG' then v_makro_active_long else v_makro_active_short end;
    orderbuch_imbalance := v_ob.depth_imbalance;
    orderbuch_active := case when v_dir = 'LONG' then v_ob_active_long else v_ob_active_short end;
    data_asof := v_oldest;

    select s.probability, s.tier into v_prob, v_tier
    from research_confluence_score(v_dir, trend_count, coalesce(fear_greed_active, false),
      coalesce(makro_active, false), coalesce(orderbuch_active, false), 'unknown') s;
    probability := v_prob;
    tier := v_tier;

    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_confluence_score_refresh()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_trend_signals text[] := array[
    'Struktur 15m','Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment',
    'CVD-Richtung','Trendstaerke (ADX+DI)','Trend-Regime (EMA50/200)','VWAP-Position'
  ];
begin
  -- Basisrate pro Richtung
  delete from research_confluence_score_woe where factor = 'base';
  insert into research_confluence_score_woe (direction, factor, level, n, x, woe)
  select direction, 'base', 'base', count(*), sum((outcome = 'TRAIL_EXIT')::int), 0
  from research_swing_setup_chain_results
  group by direction;

  -- Trend-Konfirmation (Konsens-Zaehler ueber die 9 kollinearen Signale)
  delete from research_confluence_score_woe where factor = 'trend';
  insert into research_confluence_score_woe (direction, factor, level, n, x, woe)
  select c.direction, 'trend',
    case when trend_count = 0 then '0' when trend_count = 1 then '1'
         when trend_count in (2,3) then '2-3' else '4+' end,
    count(*), sum((c.outcome = 'TRAIL_EXIT')::int),
    ln(sum((c.outcome = 'TRAIL_EXIT')::int)::numeric / nullif(count(*) - sum((c.outcome = 'TRAIL_EXIT')::int), 0))
      - (select ln(x::numeric / nullif(n - x, 0)) from research_confluence_score_woe b
         where b.factor = 'base' and b.direction = c.direction)
  from research_swing_setup_chain_results c
  join lateral (
    select count(*) as trend_count from research_confluence_signal_activation r
    where r.setup_id = c.id and r.signal_a = any(v_trend_signals) and r.is_active
  ) tc on true
  group by c.direction,
    case when trend_count = 0 then '0' when trend_count = 1 then '1'
         when trend_count in (2,3) then '2-3' else '4+' end;

  -- Fear & Greed, Makro-Regime, Orderbuch-Imbalance, Momentum (je aktiv/inaktiv)
  delete from research_confluence_score_woe where factor in ('fear_greed','makro','orderbuch','momentum');
  insert into research_confluence_score_woe (direction, factor, level, n, x, woe)
  select c.direction, f.factor, r.is_active::text, count(*), sum((c.outcome = 'TRAIL_EXIT')::int),
    case when count(*) >= 10 and (count(*) - sum((c.outcome = 'TRAIL_EXIT')::int)) > 0 then
      ln(sum((c.outcome = 'TRAIL_EXIT')::int)::numeric / nullif(count(*) - sum((c.outcome = 'TRAIL_EXIT')::int), 0))
        - (select ln(x::numeric / nullif(n - x, 0)) from research_confluence_score_woe b
           where b.factor = 'base' and b.direction = c.direction)
    else 0 end
  from research_swing_setup_chain_results c
  join research_confluence_signal_activation r on r.setup_id = c.id
  join (values
    ('Fear & Greed', 'fear_greed'), ('Makro-Regime', 'makro'),
    ('Orderbuch-Imbalance', 'orderbuch'), ('Momentum-Faktor (RSI+MACD)', 'momentum')
  ) as f(signal_a, factor) on f.signal_a = r.signal_a
  group by c.direction, f.factor, r.is_active;

  -- Tertil-Grenzen des VORAB-Scores (nur Leading-Faktoren: trend + fear_greed + makro + orderbuch)
  delete from research_confluence_score_tiers;
  insert into research_confluence_score_tiers (direction, base_logit, tier_low_max, tier_mid_max, n_total)
  select direction, base_logit, tier_low_max, tier_mid_max, n_total
  from (
    select
      s.direction,
      s.base_logit,
      percentile_cont(0.3333) within group (order by s.p_entry) as tier_low_max,
      percentile_cont(0.6667) within group (order by s.p_entry) as tier_mid_max,
      count(*) as n_total
    from (
      select c.direction,
        (select ln(x::numeric / nullif(n - x, 0)) from research_confluence_score_woe b
         where b.factor = 'base' and b.direction = c.direction) as base_logit,
        1.0 / (1.0 + exp(-(
          (select ln(x::numeric / nullif(n - x, 0)) from research_confluence_score_woe b
           where b.factor = 'base' and b.direction = c.direction)
          + coalesce((select woe from research_confluence_score_woe w where w.direction = c.direction
              and w.factor = 'trend' and w.level = (
                select case when count(*) = 0 then '0' when count(*) = 1 then '1'
                            when count(*) in (2,3) then '2-3' else '4+' end
                from research_confluence_signal_activation r
                where r.setup_id = c.id and r.signal_a = any(array[
                  'Struktur 15m','Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment',
                  'CVD-Richtung','Trendstaerke (ADX+DI)','Trend-Regime (EMA50/200)','VWAP-Position'
                ]) and r.is_active
              )), 0)
          + coalesce((select w.woe from research_confluence_score_woe w
              join research_confluence_signal_activation r on r.setup_id = c.id and r.signal_a = 'Fear & Greed'
              where w.direction = c.direction and w.factor = 'fear_greed' and w.level = r.is_active::text), 0)
          + coalesce((select w.woe from research_confluence_score_woe w
              join research_confluence_signal_activation r on r.setup_id = c.id and r.signal_a = 'Makro-Regime'
              where w.direction = c.direction and w.factor = 'makro' and w.level = r.is_active::text), 0)
          + coalesce((select w.woe from research_confluence_score_woe w
              join research_confluence_signal_activation r on r.setup_id = c.id and r.signal_a = 'Orderbuch-Imbalance'
              where w.direction = c.direction and w.factor = 'orderbuch' and w.level = r.is_active::text), 0)
        ))) as p_entry
      from research_swing_setup_chain_results c
    ) s
    group by s.direction, s.base_logit
  ) t;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_detect_candlestick_patterns(p_interval text)
 RETURNS TABLE(candle_open_time timestamp with time zone, pattern_name text, direction_expected text)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.research_directional_change_events(p_interval text, p_target_usd numeric, p_floor_pct numeric, p_floor_mode text)
 RETURNS TABLE(event_id integer, direction text, entry_time timestamp with time zone, entry_price numeric, confirm_time timestamp with time zone, confirm_price numeric, net_move_usd numeric, duration_hours numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  rec record;
  v_mode text := 'seeking_up';
  v_anchor_time timestamptz;
  v_anchor_price numeric;
  v_ext_time timestamptz;
  v_ext_price numeric;
  v_floor numeric;
  v_floor_breached boolean;
  v_target_hit boolean;
  v_event_id integer := 0;
  v_first boolean := true;
  a_event_id integer[] := '{}';
  a_direction text[] := '{}';
  a_entry_time timestamptz[] := '{}';
  a_entry_price numeric[] := '{}';
  a_confirm_time timestamptz[] := '{}';
  a_confirm_price numeric[] := '{}';
  a_net_move numeric[] := '{}';
  a_duration numeric[] := '{}';
begin
  if p_floor_mode not in ('fixed','trailing') then
    raise exception 'research_directional_change_events: p_floor_mode muss fixed oder trailing sein, war %', p_floor_mode;
  end if;

  for rec in
    select open_time, high, low, close
    from candles
    where symbol='BTCUSDT' and exchange='binance' and interval=p_interval
    order by open_time asc
  loop
    if v_first then
      v_anchor_time := rec.open_time;
      v_anchor_price := rec.low;
      v_ext_time := rec.open_time;
      v_ext_price := rec.high;
      v_mode := 'seeking_up';
      v_first := false;
      continue;
    end if;

    if v_mode = 'seeking_up' then
      if rec.high > v_ext_price then
        v_ext_price := rec.high;
        v_ext_time := rec.open_time;
      end if;
      v_floor := (case when p_floor_mode='fixed' then v_anchor_price else v_ext_price end) * (1 - p_floor_pct);
      v_floor_breached := rec.low <= v_floor;
      v_target_hit := (v_ext_price - v_anchor_price) >= p_target_usd;

      if v_floor_breached then
        v_mode := 'seeking_down';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.low;
      elsif v_target_hit then
        v_event_id := v_event_id + 1;
        a_event_id := array_append(a_event_id, v_event_id);
        a_direction := array_append(a_direction, 'UP');
        a_entry_time := array_append(a_entry_time, v_anchor_time);
        a_entry_price := array_append(a_entry_price, v_anchor_price);
        a_confirm_time := array_append(a_confirm_time, v_ext_time);
        a_confirm_price := array_append(a_confirm_price, v_ext_price);
        a_net_move := array_append(a_net_move, v_ext_price - v_anchor_price);
        a_duration := array_append(a_duration, extract(epoch from (v_ext_time - v_anchor_time)) / 3600.0);
        v_mode := 'seeking_down';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.low;
      end if;

    else
      if rec.low < v_ext_price then
        v_ext_price := rec.low;
        v_ext_time := rec.open_time;
      end if;
      v_floor := (case when p_floor_mode='fixed' then v_anchor_price else v_ext_price end) * (1 + p_floor_pct);
      v_floor_breached := rec.high >= v_floor;
      v_target_hit := (v_anchor_price - v_ext_price) >= p_target_usd;

      if v_floor_breached then
        v_mode := 'seeking_up';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.high;
      elsif v_target_hit then
        v_event_id := v_event_id + 1;
        a_event_id := array_append(a_event_id, v_event_id);
        a_direction := array_append(a_direction, 'DOWN');
        a_entry_time := array_append(a_entry_time, v_anchor_time);
        a_entry_price := array_append(a_entry_price, v_anchor_price);
        a_confirm_time := array_append(a_confirm_time, v_ext_time);
        a_confirm_price := array_append(a_confirm_price, v_ext_price);
        a_net_move := array_append(a_net_move, v_anchor_price - v_ext_price);
        a_duration := array_append(a_duration, extract(epoch from (v_ext_time - v_anchor_time)) / 3600.0);
        v_mode := 'seeking_up';
        v_anchor_time := v_ext_time;
        v_anchor_price := v_ext_price;
        v_ext_time := rec.open_time;
        v_ext_price := rec.high;
      end if;
    end if;
  end loop;

  return query
    select a_event_id[i], a_direction[i], a_entry_time[i], a_entry_price[i],
           a_confirm_time[i], a_confirm_price[i], a_net_move[i], a_duration[i]
    from generate_subscripts(a_event_id, 1) as i
    order by i;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_logit(p numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select ln(p / (1 - p));
$function$;

CREATE OR REPLACE FUNCTION public.research_norm_cdf(z numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when z < 0 then 1 - public.research_norm_cdf(-z)
    else
      1 - (
        (0.319381530*t - 0.356563782*t^2 + 1.781477937*t^3 - 1.821255978*t^4 + 1.330274429*t^5)
        * exp(-(z^2)/2) / sqrt(2*pi())
      )
  end
  from (select 1.0/(1.0+0.2316419*z) as t) k;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_bh_fdr(p_alpha numeric DEFAULT 0.05)
 RETURNS TABLE(signal_a text, direction text, n1 integer, n2 integer, hit_rate1_pct numeric, hit_rate2_pct numeric, raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean)
 LANGUAGE sql
 STABLE
AS $function$
  with testable as (
    select * from research_regime_signal_stats where min_n_met and raw_p_value is not null
  ),
  m as (
    select count(*) as total from testable
  ),
  ranked as (
    select t.*, row_number() over (order by t.raw_p_value asc) as rnk
    from testable t
  )
  select
    r.signal_a, r.direction, r.n1, r.n2, r.hit_rate1_pct, r.hit_rate2_pct, r.raw_p_value,
    r.rnk::int as rank,
    round((r.rnk::numeric / m.total) * p_alpha, 6) as bh_critical_value,
    r.raw_p_value <= (r.rnk::numeric / m.total) * p_alpha as significant_after_bh
  from ranked r, m
  order by r.raw_p_value asc;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_evaluation_events()
 RETURNS TABLE(evaluation_time timestamp with time zone, close_price numeric, atr_14 numeric, outcome text, resolution_time timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  with t0 as (
    select mf.candle_open_time as evaluation_time, mf.close_price, mf.atr_14
    from market_features mf
    where mf.interval = '1h' and mf.symbol = 'BTCUSDT'
      and mf.atr_14 is not null
      and extract(hour from mf.candle_open_time)::int % 4 = 0
  ),
  fwd as (
    select
      t0.evaluation_time, t0.close_price, t0.atr_14,
      c.open_time,
      row_number() over (partition by t0.evaluation_time order by c.open_time) as rn,
      (c.high >= t0.close_price + 1.0 * t0.atr_14) as hit_up,
      (c.low  <= t0.close_price - 1.0 * t0.atr_14) as hit_down
    from t0
    join candles c
      on c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = '1h'
      and c.open_time > t0.evaluation_time
      and c.open_time <= t0.evaluation_time + interval '4 hours'
  ),
  first_hits as (
    select
      evaluation_time, close_price, atr_14,
      max(rn) as max_rn,
      min(rn) filter (where hit_up) as up_rn,
      min(rn) filter (where hit_down) as down_rn,
      min(open_time) filter (where hit_up) as up_time,
      min(open_time) filter (where hit_down) as down_time
    from fwd
    group by evaluation_time, close_price, atr_14
  ),
  resolved as (
    select
      evaluation_time, close_price, atr_14,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then 'NEUTRAL'
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then 'UP'
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then 'DOWN'
        when max_rn >= 4 then 'NEUTRAL'
        else null
      end as outcome,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then up_time
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then up_time
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then down_time
        when max_rn >= 4 then evaluation_time + interval '4 hours'
        else null
      end as resolution_time
    from first_hits
  )
  select evaluation_time, close_price, atr_14, outcome, resolution_time
  from resolved
  where outcome is not null;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_evaluation_events_daily_weekday()
 RETURNS TABLE(evaluation_time timestamp with time zone, close_price numeric, atr_14 numeric, outcome text, resolution_time timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  with t0 as (
    select mf.candle_open_time as evaluation_time, mf.close_price, mf.atr_14
    from market_features mf
    where mf.interval = '1h' and mf.symbol = 'BTCUSDT'
      and mf.atr_14 is not null
      and extract(hour from mf.candle_open_time)::int = 0
      and extract(dow from mf.candle_open_time) not in (0, 6)
  ),
  fwd as (
    select
      t0.evaluation_time, t0.close_price, t0.atr_14,
      c.open_time,
      row_number() over (partition by t0.evaluation_time order by c.open_time) as rn,
      (c.high >= t0.close_price + 1.0 * t0.atr_14) as hit_up,
      (c.low  <= t0.close_price - 1.0 * t0.atr_14) as hit_down
    from t0
    join candles c
      on c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = '1h'
      and c.open_time > t0.evaluation_time
      and c.open_time <= t0.evaluation_time + interval '24 hours'
  ),
  first_hits as (
    select
      evaluation_time, close_price, atr_14,
      max(rn) as max_rn,
      min(rn) filter (where hit_up) as up_rn,
      min(rn) filter (where hit_down) as down_rn,
      min(open_time) filter (where hit_up) as up_time,
      min(open_time) filter (where hit_down) as down_time
    from fwd
    group by evaluation_time, close_price, atr_14
  ),
  resolved as (
    select
      evaluation_time, close_price, atr_14,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then 'NEUTRAL'
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then 'UP'
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then 'DOWN'
        when max_rn >= 24 then 'NEUTRAL'
        else null
      end as outcome,
      case
        when up_rn is not null and down_rn is not null and up_rn = down_rn then up_time
        when up_rn is not null and (down_rn is null or up_rn < down_rn) then up_time
        when down_rn is not null and (up_rn is null or down_rn < up_rn) then down_time
        when max_rn >= 24 then evaluation_time + interval '24 hours'
        else null
      end as resolution_time
    from first_hits
  )
  select evaluation_time, close_price, atr_14, outcome, resolution_time
  from resolved
  where outcome is not null;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Struktur 15m/1h/4h/1d (Leading, Toleranzen wie Confluence-Score-Protokoll 6b)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 15m', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 1h', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 4h', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '8 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '4h' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Struktur 1d', dir.direction, e.outcome,
    coalesce((
      select m.structure_trend = (case when dir.direction = 'UP' then 'bullish' else 'bearish' end)
             and e.evaluation_time - m.candle_open_time <= interval '30 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1d' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- MTF-Alignment (striktes 3-Way-Match 1h/4h/1d, je eigene Toleranz)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'MTF-Alignment', dir.direction, e.outcome,
    coalesce((
      select
        (m1h.structure_trend = tgt and e.evaluation_time - m1h.candle_open_time <= interval '4 hours')
        and (m4h.structure_trend = tgt and e.evaluation_time - m4h.candle_open_time <= interval '8 hours')
        and (m1d.structure_trend = tgt and e.evaluation_time - m1d.candle_open_time <= interval '30 hours')
      from
        (select case when dir.direction = 'UP' then 'bullish' else 'bearish' end as tgt) t,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1h' and candle_open_time <= e.evaluation_time
                 order by candle_open_time desc limit 1) m1h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='4h' and candle_open_time <= e.evaluation_time
                 order by candle_open_time desc limit 1) m4h,
        lateral (select structure_trend, candle_open_time from market_features
                 where symbol='BTCUSDT' and interval='1d' and candle_open_time <= e.evaluation_time
                 order by candle_open_time desc limit 1) m1d
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- CVD-Richtung (15m, Toleranz 4h)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CVD-Richtung', dir.direction, e.outcome,
    coalesce((
      select m.cvd_trend = (case when dir.direction = 'UP' then 'rising' else 'falling' end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Trendstaerke (ADX+DI), 15m, Toleranz 4h
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Trendstaerke (ADX+DI)', dir.direction, e.outcome,
    coalesce((
      select m.adx_14 >= 20
             and (case when dir.direction = 'UP' then m.plus_di > m.minus_di else m.minus_di > m.plus_di end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Trend-Regime (EMA50/200), 15m, Toleranz 4h
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Trend-Regime (EMA50/200)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then m.ema_50 > m.ema_200 else m.ema_50 < m.ema_200 end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- VWAP-Position, 15m, Toleranz 4h
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'VWAP-Position', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then m.close_price > m.vwap else m.close_price < m.vwap end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Fear & Greed (kontrarisch, Toleranz 30h)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Fear & Greed', dir.direction, e.outcome,
    coalesce((
      select s.classification = (case when dir.direction = 'UP' then 'Extreme Fear' else 'Extreme Greed' end)
             and e.evaluation_time - s.timestamp_utc <= interval '30 hours'
      from sentiment_snapshots s
      where s.source = 'alternative.me' and s.timestamp_utc <= e.evaluation_time
      order by s.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Makro-Regime (Risk-On->UP, Risk-Off->DOWN)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Makro-Regime', dir.direction, e.outcome,
    coalesce(
      (get_macro_regime_asof(e.evaluation_time) ->> 'regime') =
      (case when dir.direction = 'UP' then 'Risk-On' else 'Risk-Off' end),
      false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Orderbuch-Imbalance (Toleranz 4h, Schwelle 0.08 Betrag)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Orderbuch-Imbalance', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then o.depth_imbalance > 0.08 else o.depth_imbalance < -0.08 end)
             and e.evaluation_time - o.timestamp_utc <= interval '4 hours'
      from orderbook_snapshots o
      where o.exchange = 'binance' and o.symbol = 'BTCUSDT' and o.timestamp_utc <= e.evaluation_time
      order by o.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Momentum-Faktor (RSI+MACD) -- hier reine Leading-Neuinterpretation
  -- (Zustand AM Bewertungszeitpunkt, kein Confirming-Warten auf +0,25%,
  -- siehe Abschnitt 3 des Protokolls), 15m, Toleranz 4h.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Momentum-Faktor (RSI+MACD)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then m.rsi_14 > 50 and m.macd_histogram > 0
                   else m.rsi_14 < 50 and m.macd_histogram < 0 end)
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '15m' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Regressionssteigung (Regime-Matrix, 1h, Trendfolge: positive Steigung -> UP)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Regressionssteigung', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.linreg_slope > 0 else rm.linreg_slope < 0 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Distanz-zu-SMA50-Z-Score (Regime-Matrix, 1h, Mean-Reversion: stark ueber
  -- SMA50 -> DOWN-Hypothese, stark darunter -> UP-Hypothese, Schwelle |z|>=1,5)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Distanz-SMA50-Z (Mean-Reversion)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.dist_zscore_sma50 <= -1.5 else rm.dist_zscore_sma50 >= 1.5 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- CVD-Z-Score (Regime-Matrix, 1h, Trendfolge, Schwelle |z|>=1,0 -- eigene
  -- Operationalisierung neben dem Roh-Vorzeichen "CVD-Richtung" oben)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CVD-Z-Score', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.cvd_zscore >= 1.0 else rm.cvd_zscore <= -1.0 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Bollinger %b (Regime-Matrix, 1h, Mean-Reversion: nahe/ueber oberem Band
  -- -> DOWN-Hypothese, nahe/unter unterem Band -> UP-Hypothese)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Bollinger %b (Mean-Reversion)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.bb_percent_b <= 0.2 else rm.bb_percent_b >= 0.8 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation_round2()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Funding-Z-Score (kontrarisch: hohe positive Z = Crowded Longs -> DOWN,
  -- hohe negative Z = Crowded Shorts -> UP, Schwelle |z|>=1,5).
  -- KORRIGIERT (13.09.2026): vorher aus market_state_matrix.funding_zscore
  -- gelesen, das nur ~3 Wochen echte Werte hatte (Rest durch coalesce(false)
  -- faelschlich als "inaktiv" gewertet, identischer Fehler wie die
  -- urspruengliche Runde-4-Datenluecke). Jetzt aus der vollstaendig bis
  -- 2022-09-04 zurueckbefuellten research_funding_rate_history (siehe
  -- PHASE1-RESULTS-Dokument, Datenverfuegbarkeits-Audit).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Funding-Z-Score', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then r.funding_zscore <= -1.5 else r.funding_zscore >= 1.5 end
      from research_funding_rate_history r
      where r.funding_time <= e.evaluation_time and r.funding_zscore is not null
      order by r.funding_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Net-Taker-Flow-Ratio (Spot, Momentum: positiv -> UP, negativ -> DOWN)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Net-Taker-Flow-Ratio', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.net_taker_flow_ratio > 0 else rm.net_taker_flow_ratio < 0 end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- OI-vs-Preis-Quadrant (nur long_buildup->UP, short_buildup->DOWN)
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'OI-Quadrant (Buildup)', dir.direction, e.outcome,
    coalesce((
      select (case when dir.direction = 'UP' then rm.oi_price_quadrant = 'long_buildup' else rm.oi_price_quadrant = 'short_buildup' end)
      from market_state_matrix rm
      where rm.symbol = 'BTCUSDT' and rm.interval = '1h' and rm.timestamp_utc <= e.evaluation_time
      order by rm.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation_round3()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Kandidat 1: Preis > Top-CPR -> UP (nur UP, siehe Vorregistrierung).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPR-Position (Preis > Top)', 'UP', e.outcome,
    coalesce(
      (select c.close from candles c
       where c.symbol = 'BTCUSDT' and c.interval = '1h' and c.exchange = 'binance'
         and c.open_time <= e.evaluation_time
       order by c.open_time desc limit 1)
      >
      (select (2 * ((d.high + d.low + d.close) / 3.0) - (d.high + d.low) / 2.0)
       from candles d
       where d.symbol = 'BTCUSDT' and d.interval = '1d' and d.exchange = 'binance'
         and d.close_time <= e.evaluation_time
       order by d.close_time desc limit 1),
      false
    )
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: Preis < Bottom-CPR -> DOWN (nur DOWN, siehe Vorregistrierung).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPR-Position (Preis < Bottom)', 'DOWN', e.outcome,
    coalesce(
      (select c.close from candles c
       where c.symbol = 'BTCUSDT' and c.interval = '1h' and c.exchange = 'binance'
         and c.open_time <= e.evaluation_time
       order by c.open_time desc limit 1)
      <
      (select (d.high + d.low) / 2.0
       from candles d
       where d.symbol = 'BTCUSDT' and d.interval = '1d' and d.exchange = 'binance'
         and d.close_time <= e.evaluation_time
       order by d.close_time desc limit 1),
      false
    )
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 3: CPR-Breite eng (unterstes Tertil der letzten 20 Tageskerzen
  -- VOR der aktuellen CPR-Tageskerze) -> BEIDE Richtungen, siehe Vorregistrierung.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPR-Breite eng', dir.direction, e.outcome,
    coalesce((
      with cur as (
        select
          ((2 * ((high + low + close) / 3.0) - (high + low) / 2.0) - (high + low) / 2.0)
            / nullif((high + low + close) / 3.0, 0) * 100 as width_pct,
          close_time as cur_close_time
        from candles
        where symbol = 'BTCUSDT' and interval = '1d' and exchange = 'binance'
          and close_time <= e.evaluation_time
        order by close_time desc
        limit 1
      ),
      recent as (
        select
          ((2 * ((candles.high + candles.low + candles.close) / 3.0) - (candles.high + candles.low) / 2.0) - (candles.high + candles.low) / 2.0)
            / nullif((candles.high + candles.low + candles.close) / 3.0, 0) * 100 as width_pct
        from candles, cur
        where candles.symbol = 'BTCUSDT' and candles.interval = '1d' and candles.exchange = 'binance'
          and candles.close_time < cur.cur_close_time
        order by candles.close_time desc
        limit 20
      )
      select cur.width_pct <= (select percentile_cont(0.3333) within group (order by recent.width_pct) from recent)
      from cur
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation_round4()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Kandidat 1: DXY-Bewegung -- UP (faellt < -0.3%) und DOWN (steigt > +0.3%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'DXY-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct < -0.3 else m.change_pct > 0.3 end
      from macro_snapshots m
      where m.symbol = 'DX-Y.NYB' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: S&P-500-Bewegung -- UP (> +0.5%) und DOWN (< -0.5%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'S&P-500-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct > 0.5 else m.change_pct < -0.5 end
      from macro_snapshots m
      where m.symbol = '^GSPC' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 3: Nasdaq-Bewegung -- UP (> +0.5%) und DOWN (< -0.5%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Nasdaq-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct > 0.5 else m.change_pct < -0.5 end
      from macro_snapshots m
      where m.symbol = '^IXIC' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 4: VIX erhoeht (>25) -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'VIX erhöht', 'DOWN', e.outcome,
    coalesce((
      select m.last_price > 25
      from macro_snapshots m
      where m.symbol = '^VIX' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 5: Net-Liquidity steigt (Fed-Bilanz - TGA - RRP, > +0.5%) -- NUR UP.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Net-Liquidity steigt', 'UP', e.outcome,
    coalesce((
      with vals as (
        select
          (select m.last_price from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_now,
          (select m.prev_close from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_prev,
          (select m.last_price from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_now,
          (select m.prev_close from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_prev,
          (select m.last_price from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_now,
          (select m.prev_close from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_prev
      )
      select
        (walcl_now - tga_now - rrp_now - (walcl_prev - tga_prev - rrp_prev))
          / nullif(abs(walcl_prev - tga_prev - rrp_prev), 0) * 100 > 0.5
      from vals
      where walcl_now is not null and walcl_prev is not null and tga_now is not null
        and tga_prev is not null and rrp_now is not null and rrp_prev is not null
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 6: USD/JPY faellt (Yen staerker, < -0.3%) -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'USD/JPY fällt', 'DOWN', e.outcome,
    coalesce((
      select m.change_pct < -0.3
      from macro_snapshots m
      where m.symbol = 'JPY=X' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 7: Gold-Bewegung -- Ko-Bewegung: UP (> +0.5%), DOWN (< -0.5%).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Gold-Bewegung', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then m.change_pct > 0.5 else m.change_pct < -0.5 end
      from macro_snapshots m
      where m.symbol = 'GC=F' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation_round5()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Kandidat 1: M2-Wachstum (jede Zunahme) -- NUR UP.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'M2-Wachstum', 'UP', e.outcome,
    coalesce((
      select m.change_pct > 0
      from macro_snapshots m
      where m.symbol = 'M2SL' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: CPI-Anstieg -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CPI-Anstieg', 'DOWN', e.outcome,
    coalesce((
      select m.change_pct > 0
      from macro_snapshots m
      where m.symbol = 'CPIAUCSL' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 3: PCE-Anstieg -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'PCE-Anstieg', 'DOWN', e.outcome,
    coalesce((
      select m.change_pct > 0
      from macro_snapshots m
      where m.symbol = 'PCEPI' and m.status = 'ok' and m.timestamp_utc <= e.evaluation_time
      order by m.timestamp_utc desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation_round6()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Kandidat 1: CCI-Extrem -- Trend-Fortsetzung, |CCI| >= 100.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CCI-Extrem (Fortsetzung)', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then r.cci >= 100 else r.cci <= -100 end
      from research_regime_cci_roc_1h r
      where r.candle_open_time <= e.evaluation_time and r.cci is not null
      order by r.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: ROC-Z-Score -- Momentum-Fortsetzung, |z| >= 1.0 (Stddev ueber
  -- die volle Historie, siehe Vorregistrierung).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'ROC-Z-Score', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then r.roc >= 1.844195360030752
                  else r.roc <= -1.844195360030752 end
      from research_regime_cci_roc_1h r
      where r.candle_open_time <= e.evaluation_time and r.roc is not null
      order by r.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_extend_activation_round7()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- Kandidat 1: Fragile Bullish (structure=bullish, cvd=falling) -- NUR UP.
  -- 1:1 aus compute-market-state, beide Werte aus derselben 1h-Zeile.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Fragile Bullish', 'UP', e.outcome,
    coalesce((
      select m.structure_trend = 'bullish' and m.cvd_trend = 'falling'
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= e.evaluation_time
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: Distribution Warning (Preis < 0,5xATR14 vom 20er-Hoch, cvd=falling) -- NUR DOWN.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'Distribution Warning', 'DOWN', e.outcome,
    coalesce((
      select (m.range_high_20 - m.close_price) < 0.5 * m.atr_14 and m.cvd_trend = 'falling'
             and e.evaluation_time - m.candle_open_time <= interval '4 hours'
      from market_features m
      where m.symbol = 'BTCUSDT' and m.interval = '1h' and m.candle_open_time <= e.evaluation_time
        and m.range_high_20 is not null and m.atr_14 is not null and m.close_price is not null
      order by m.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_macro_retest_daily_weekday(p_alpha numeric DEFAULT 0.05)
 RETURNS TABLE(signal_a text, direction text, n1 integer, n2 integer, hit_rate1_pct numeric, hit_rate2_pct numeric, raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean)
 LANGUAGE sql
 STABLE
AS $function$
  with events as (
    select * from research_regime_evaluation_events_daily_weekday()
  ),
  activation as (
    select e.evaluation_time, 'DXY-Bewegung'::text as signal_a, 'UP'::text as direction, e.outcome,
      coalesce((select m.change_pct < -0.3 from macro_snapshots m where m.symbol='DX-Y.NYB' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false) as is_active
    from events e
    union all
    select e.evaluation_time, 'DXY-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct > 0.3 from macro_snapshots m where m.symbol='DX-Y.NYB' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'S&P-500-Bewegung', 'UP', e.outcome,
      coalesce((select m.change_pct > 0.5 from macro_snapshots m where m.symbol='^GSPC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'S&P-500-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.5 from macro_snapshots m where m.symbol='^GSPC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Nasdaq-Bewegung', 'UP', e.outcome,
      coalesce((select m.change_pct > 0.5 from macro_snapshots m where m.symbol='^IXIC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Nasdaq-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.5 from macro_snapshots m where m.symbol='^IXIC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Gold-Bewegung', 'UP', e.outcome,
      coalesce((select m.change_pct > 0.5 from macro_snapshots m where m.symbol='GC=F' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Gold-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.5 from macro_snapshots m where m.symbol='GC=F' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'VIX erhöht', 'DOWN', e.outcome,
      coalesce((select m.last_price > 25 from macro_snapshots m where m.symbol='^VIX' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Net-Liquidity steigt', 'UP', e.outcome,
      coalesce((
        with vals as (
          select
            (select m.last_price from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_now,
            (select m.prev_close from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_prev,
            (select m.last_price from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_now,
            (select m.prev_close from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_prev,
            (select m.last_price from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_now,
            (select m.prev_close from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_prev
        )
        select (walcl_now - tga_now - rrp_now - (walcl_prev - tga_prev - rrp_prev)) / nullif(abs(walcl_prev - tga_prev - rrp_prev), 0) * 100 > 0.5
        from vals
        where walcl_now is not null and walcl_prev is not null and tga_now is not null
          and tga_prev is not null and rrp_now is not null and rrp_prev is not null
      ), false)
    from events e
    union all
    select e.evaluation_time, 'USD/JPY fällt', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.3 from macro_snapshots m where m.symbol='JPY=X' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'M2-Wachstum', 'UP', e.outcome,
      coalesce((select m.change_pct > 0 from macro_snapshots m where m.symbol='M2SL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'CPI-Anstieg', 'DOWN', e.outcome,
      coalesce((select m.change_pct > 0 from macro_snapshots m where m.symbol='CPIAUCSL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'PCE-Anstieg', 'DOWN', e.outcome,
      coalesce((select m.change_pct > 0 from macro_snapshots m where m.symbol='PCEPI' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
  ),
  stats as (
    select signal_a, direction,
      count(*) filter (where is_active) as n_active,
      count(*) filter (where not is_active) as n_inactive,
      count(*) filter (where is_active and outcome = direction) as hits_active,
      count(*) filter (where not is_active and outcome = direction) as hits_inactive
    from activation
    group by signal_a, direction
  ),
  props as (
    select *,
      hits_active::numeric / nullif(n_active, 0) as p1,
      hits_inactive::numeric / nullif(n_inactive, 0) as p2,
      (hits_active + hits_inactive)::numeric / nullif(n_active + n_inactive, 0) as p_pool
    from stats
    where n_active >= 10 and n_inactive >= 10
  ),
  zvals as (
    select *,
      (p1 - p2) / nullif(sqrt(p_pool * (1 - p_pool) * (1.0 / nullif(n_active, 0) + 1.0 / nullif(n_inactive, 0))), 0) as z
    from props
  ),
  pvals as (
    select *,
      case when z is null then 1.0 else erfc(abs(z::double precision) / sqrt(2))::numeric end as raw_p
    from zvals
  ),
  ranked as (
    select *, row_number() over (order by raw_p asc) as rnk, count(*) over () as m
    from pvals
  ),
  crit as (
    select *, (rnk::numeric / m) * p_alpha as bh_crit
    from ranked
  ),
  maxk as (
    select coalesce(max(rnk) filter (where raw_p <= bh_crit), 0) as k from crit
  )
  select
    crit.signal_a, crit.direction, crit.n_active as n1, crit.n_inactive as n2,
    round(crit.p1 * 100, 1) as hit_rate1_pct, round(crit.p2 * 100, 1) as hit_rate2_pct,
    crit.raw_p as raw_p_value, crit.rnk::integer as rank, round(crit.bh_crit, 6) as bh_critical_value,
    (crit.rnk <= (select k from maxk)) as significant_after_bh
  from crit
  order by crit.direction, crit.raw_p asc;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_refresh_cci_roc_1h()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  drop table if exists tmp_cci_candles_1h;
  drop table if exists tmp_cci_sma;

  create temp table tmp_cci_candles_1h on commit drop as
  select open_time, close, (high + low + close) / 3.0 as typical_price
  from candles
  where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h';

  create index on tmp_cci_candles_1h (open_time);

  create temp table tmp_cci_sma on commit drop as
  select open_time, close, typical_price,
    avg(typical_price) over (order by open_time rows between 19 preceding and current row) as sma20,
    count(*) over (order by open_time rows between 19 preceding and current row) as cnt20,
    lag(close, 14) over (order by open_time) as close_14_ago
  from tmp_cci_candles_1h;

  create index on tmp_cci_sma (open_time);

  truncate table research_regime_cci_roc_1h;

  insert into research_regime_cci_roc_1h (candle_open_time, cci, roc)
  select
    s.open_time,
    case when s.cnt20 = 20 and md.mean_dev > 0 then (s.typical_price - s.sma20) / (0.015 * md.mean_dev) else null end,
    case when s.close_14_ago is not null and s.close_14_ago <> 0 then (s.close - s.close_14_ago) / s.close_14_ago * 100 else null end
  from tmp_cci_sma s
  cross join lateral (
    select avg(abs(sub.typical_price - s.sma20)) as mean_dev
    from (
      select typical_price
      from tmp_cci_candles_1h c
      where c.open_time <= s.open_time
      order by c.open_time desc
      limit 20
    ) sub
  ) md;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_refresh_funding_history()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_last timestamptz;
  v_start_ms bigint;
  v_request_id bigint;
  v_status int;
  v_content text;
  v_tries int := 0;
begin
  select max(funding_time) into v_last from research_funding_rate_history;
  v_start_ms := (extract(epoch from coalesce(v_last, '2022-09-04'::timestamptz)) * 1000 + 1)::bigint;

  v_request_id := net.http_get(
    url := 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=' || v_start_ms || '&limit=1000'
  );

  loop
    v_tries := v_tries + 1;
    perform pg_sleep(1);
    select status_code, content into v_status, v_content from net._http_response where id = v_request_id;
    exit when v_status is not null or v_tries >= 10;
  end loop;

  if v_status = 200 then
    insert into research_funding_rate_history (funding_time, funding_rate)
    select to_timestamp((elem->>'fundingTime')::bigint / 1000.0), (elem->>'fundingRate')::numeric
    from jsonb_array_elements(v_content::jsonb) as elem
    on conflict (funding_time) do nothing;
  end if;

  -- Z-Score fuer die komplette Historie neu berechnen (billig genug bei
  -- ~4.400 Zeilen, vermeidet fehleranfaellige Teil-Updates am Fensterrand).
  with z as (
    select funding_time,
      avg(funding_rate) over w as mean_fr,
      stddev_samp(funding_rate) over w as std_fr,
      count(*) over w as cnt
    from research_funding_rate_history
    window w as (order by funding_time rows between 89 preceding and current row)
  )
  update research_funding_rate_history r
  set funding_zscore = case when z.cnt = 90 and z.std_fr > 0 then (r.funding_rate - z.mean_fr) / z.std_fr else null end
  from z
  where r.funding_time = z.funding_time;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_refresh_stats()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_min_n constant integer := 10;
begin
  delete from research_regime_signal_stats;

  insert into research_regime_signal_stats (signal_a, direction, n1, x1, n2, x2, min_n_met)
  select
    signal_a, direction,
    count(*) filter (where is_active) as n1,
    count(*) filter (where is_active and outcome = direction) as x1,
    count(*) filter (where not is_active) as n2,
    count(*) filter (where not is_active and outcome = direction) as x2,
    (count(*) filter (where is_active) >= v_min_n and count(*) filter (where not is_active) >= v_min_n) as min_n_met
  from research_regime_signal_activation
  group by signal_a, direction;

  update research_regime_signal_stats s
  set
    hit_rate1_pct = round(100.0 * s.x1 / nullif(s.n1, 0), 1),
    hit_rate2_pct = round(100.0 * s.x2 / nullif(s.n2, 0), 1),
    wilson1_lower = w1.lower, wilson1_upper = w1.upper,
    wilson2_lower = w2.lower, wilson2_upper = w2.upper,
    z_score = zt.z_score,
    raw_p_value = zt.raw_p_value
  from research_regime_signal_stats s2
  cross join lateral research_wilson_ci(s2.x1, s2.n1) w1
  cross join lateral research_wilson_ci(s2.x2, s2.n2) w2
  cross join lateral research_two_proportion_ztest(s2.x1, s2.n1, s2.x2, s2.n2) zt
  where s.id = s2.id and s2.min_n_met;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_score_live()
 RETURNS TABLE(out_direction text, trend_konsens integer, cvd_z_active boolean, momentum_active boolean, bollinger_pctb_active boolean, dxy_active boolean, cci_active boolean, fragile_bullish_active boolean, probability numeric, tier text, data_asof timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_now timestamptz := now();
  v_1h record;
  v_4h record;
  v_1d record;
  v_rm record;
  v_dxy record;
  v_cci_agg record;
  v_cci numeric;
  v_konsens_up integer;
  v_konsens_down integer;
  v_cvdz_up boolean;
  v_cvdz_down boolean;
  v_bb_up boolean;
  v_mom_down boolean;
  v_dxy_up boolean;
  v_dxy_down boolean;
  v_cci_up boolean;
  v_cci_down boolean;
  v_fb_up boolean;
  v_asof timestamptz;
begin
  select structure_trend, cvd_trend, candle_open_time into v_1h from market_features
  where symbol='BTCUSDT' and interval='1h' and candle_open_time <= v_now order by candle_open_time desc limit 1;
  select structure_trend, candle_open_time into v_4h from market_features
  where symbol='BTCUSDT' and interval='4h' and candle_open_time <= v_now order by candle_open_time desc limit 1;
  select structure_trend, candle_open_time into v_1d from market_features
  where symbol='BTCUSDT' and interval='1d' and candle_open_time <= v_now order by candle_open_time desc limit 1;

  -- Fragile Bullish (Runde 7): structure=bullish + cvd=falling, dieselbe
  -- 1h-Zeile wie compute-market-state, 4h-Toleranz wie Struktur 1h.
  v_fb_up := coalesce(
    v_1h.structure_trend = 'bullish' and v_1h.cvd_trend = 'falling'
    and v_now - v_1h.candle_open_time <= interval '4 hours',
    false
  );

  declare
    v_15m record;
  begin
    select adx_14, plus_di, minus_di, candle_open_time into v_15m from market_features
    where symbol='BTCUSDT' and interval='15m' and candle_open_time <= v_now order by candle_open_time desc limit 1;

    v_konsens_up := 0;
    v_konsens_down := 0;

    if v_1h.structure_trend = 'bullish' and v_now - v_1h.candle_open_time <= interval '4 hours' then v_konsens_up := v_konsens_up + 1; end if;
    if v_1h.structure_trend = 'bearish' and v_now - v_1h.candle_open_time <= interval '4 hours' then v_konsens_down := v_konsens_down + 1; end if;
    if v_4h.structure_trend = 'bullish' and v_now - v_4h.candle_open_time <= interval '8 hours' then v_konsens_up := v_konsens_up + 1; end if;
    if v_4h.structure_trend = 'bearish' and v_now - v_4h.candle_open_time <= interval '8 hours' then v_konsens_down := v_konsens_down + 1; end if;
    if v_1d.structure_trend = 'bullish' and v_now - v_1d.candle_open_time <= interval '30 hours' then v_konsens_up := v_konsens_up + 1; end if;
    if v_1d.structure_trend = 'bearish' and v_now - v_1d.candle_open_time <= interval '30 hours' then v_konsens_down := v_konsens_down + 1; end if;

    if v_1h.structure_trend = 'bullish' and v_now - v_1h.candle_open_time <= interval '4 hours'
       and v_4h.structure_trend = 'bullish' and v_now - v_4h.candle_open_time <= interval '8 hours'
       and v_1d.structure_trend = 'bullish' and v_now - v_1d.candle_open_time <= interval '30 hours'
    then v_konsens_up := v_konsens_up + 1; end if;
    if v_1h.structure_trend = 'bearish' and v_now - v_1h.candle_open_time <= interval '4 hours'
       and v_4h.structure_trend = 'bearish' and v_now - v_4h.candle_open_time <= interval '8 hours'
       and v_1d.structure_trend = 'bearish' and v_now - v_1d.candle_open_time <= interval '30 hours'
    then v_konsens_down := v_konsens_down + 1; end if;

    if v_15m.adx_14 >= 20 and v_15m.plus_di > v_15m.minus_di and v_now - v_15m.candle_open_time <= interval '4 hours' then v_konsens_up := v_konsens_up + 1; end if;
    if v_15m.adx_14 >= 20 and v_15m.minus_di > v_15m.plus_di and v_now - v_15m.candle_open_time <= interval '4 hours' then v_konsens_down := v_konsens_down + 1; end if;

    select rsi_14, macd_histogram into v_15m from market_features
    where symbol='BTCUSDT' and interval='15m' and candle_open_time <= v_now order by candle_open_time desc limit 1;
    v_mom_down := coalesce(v_15m.rsi_14 < 50 and v_15m.macd_histogram < 0, false);
  end;

  select linreg_slope, cvd_zscore, bb_percent_b, timestamp_utc into v_rm from market_state_matrix
  where symbol='BTCUSDT' and interval='1h' and timestamp_utc <= v_now order by timestamp_utc desc limit 1;
  v_asof := v_rm.timestamp_utc;

  if v_rm.linreg_slope > 0 then v_konsens_up := v_konsens_up + 1; end if;
  if v_rm.linreg_slope < 0 then v_konsens_down := v_konsens_down + 1; end if;

  v_cvdz_up := coalesce(v_rm.cvd_zscore >= 1.0, false);
  v_cvdz_down := coalesce(v_rm.cvd_zscore <= -1.0, false);
  v_bb_up := coalesce(v_rm.bb_percent_b <= 0.2, false);

  select change_pct into v_dxy from macro_snapshots
  where symbol = 'DX-Y.NYB' and status = 'ok' and timestamp_utc <= v_now
  order by timestamp_utc desc limit 1;
  v_dxy_up := coalesce(v_dxy.change_pct < -0.3, false);
  v_dxy_down := coalesce(v_dxy.change_pct > 0.3, false);

  -- CCI(20) live -- letzte 20 abgeschlossene 1h-Kerzen (Binance BTCUSDT),
  -- frisch berechnet (nicht aus der einmaligen Backfill-Tabelle
  -- research_regime_cci_roc_1h, die nur die Historie bis zum Runde-6-Test
  -- abdeckt). Schwelle |CCI| >= 100, siehe Runde-6-Vorregistrierung.
  with last20 as (
    select open_time, (high + low + close) / 3.0 as typical_price
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h' and open_time <= v_now
    order by open_time desc
    limit 20
  )
  select
    (select typical_price from last20 order by open_time desc limit 1) as tp_now,
    avg(typical_price) as sma20,
    count(*) as cnt
  into v_cci_agg
  from last20;

  with last20 as (
    select (high + low + close) / 3.0 as typical_price
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = '1h' and open_time <= v_now
    order by open_time desc
    limit 20
  )
  select avg(abs(l.typical_price - v_cci_agg.sma20))
  into v_cci
  from last20 l;

  if v_cci_agg.cnt = 20 and v_cci > 0 then
    v_cci := (v_cci_agg.tp_now - v_cci_agg.sma20) / (0.015 * v_cci);
  else
    v_cci := null;
  end if;

  v_cci_up := coalesce(v_cci >= 100, false);
  v_cci_down := coalesce(v_cci <= -100, false);

  return query
  select 'UP'::text, v_konsens_up, v_cvdz_up, null::boolean, v_bb_up, v_dxy_up, v_cci_up, v_fb_up,
    round(research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='dxy' and level=v_dxy_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cci' and level=v_cci_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='fragile_bullish' and level=v_fb_up::text),0)
    ), 1) as probability,
    case when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='dxy' and level=v_dxy_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cci' and level=v_cci_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='fragile_bullish' and level=v_fb_up::text),0)
    ) <= t.tier_low_max_pct then 'Niedrig'
    when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='dxy' and level=v_dxy_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cci' and level=v_cci_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='fragile_bullish' and level=v_fb_up::text),0)
    ) <= t.tier_mid_max_pct then 'Mittel' else 'Hoch' end as tier,
    v_asof
  from (select base_logit, research_sigmoid(tier_low_max) as tier_low_max_pct, research_sigmoid(tier_mid_max) as tier_mid_max_pct from research_regime_score_tiers where research_regime_score_tiers.direction='UP') t
  union all
  select 'DOWN'::text, v_konsens_down, v_cvdz_down, v_mom_down, null::boolean, v_dxy_down, v_cci_down, null::boolean,
    round(research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='dxy' and level=v_dxy_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cci' and level=v_cci_down::text),0)
    ), 1) as probability,
    case when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='dxy' and level=v_dxy_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cci' and level=v_cci_down::text),0)
    ) <= t.tier_low_max_pct then 'Niedrig'
    when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='dxy' and level=v_dxy_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cci' and level=v_cci_down::text),0)
    ) <= t.tier_mid_max_pct then 'Mittel' else 'Hoch' end as tier,
    v_asof
  from (select base_logit, research_sigmoid(tier_low_max) as tier_low_max_pct, research_sigmoid(tier_mid_max) as tier_mid_max_pct from research_regime_score_tiers where research_regime_score_tiers.direction='DOWN') t;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_regime_score_refresh()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_base_up numeric;
  v_base_down numeric;
  v_n_total integer;
  v_trend_signals constant text[] := array[
    'Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung'
  ];
begin
  delete from research_regime_score_woe;
  delete from research_regime_score_tiers;

  select count(*) into v_n_total from research_regime_evaluation_events();
  select avg((outcome='UP')::int) into v_base_up from research_regime_evaluation_events();
  select avg((outcome='DOWN')::int) into v_base_down from research_regime_evaluation_events();

  -- Trend-Konsens (0-6) je Richtung: wie viele der 6 Trend-Signale zeigten
  -- zum Bewertungszeitpunkt in GENAU DIESE Richtung.
  insert into research_regime_score_woe (direction, factor, level, n, x, woe)
  select dir, 'trend_konsens', konsens::text,
    count(*) as n,
    count(*) filter (where outcome = dir) as x,
    null::numeric
  from (
    select e.evaluation_time, e.outcome, dirs.direction as dir,
      sum(case when a.signal_a = any(v_trend_signals) and a.direction = dirs.direction and a.is_active then 1 else 0 end) as konsens
    from research_regime_evaluation_events() e
    join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
    cross join (values ('UP'),('DOWN')) as dirs(direction)
    group by e.evaluation_time, e.outcome, dirs.direction
  ) s
  group by dir, konsens;

  -- CVD-Z-Score (beide Richtungen), Momentum-Faktor (nur DOWN signifikant),
  -- Bollinger %b (nur UP signifikant), DXY-Bewegung (beide Richtungen,
  -- Runde 4), CCI-Extrem (beide Richtungen, Runde 6), Fragile Bullish (nur
  -- UP signifikant, Runde 7) -- siehe Phase-1-Ergebnisse.
  insert into research_regime_score_woe (direction, factor, level, n, x, woe)
  select direction, 'cvd_z', is_active::text, count(*), count(*) filter (where outcome = direction), null::numeric
  from research_regime_signal_activation
  where signal_a = 'CVD-Z-Score'
  group by direction, is_active
  union all
  select direction, 'momentum', is_active::text, count(*), count(*) filter (where outcome = direction), null::numeric
  from research_regime_signal_activation
  where signal_a = 'Momentum-Faktor (RSI+MACD)' and direction = 'DOWN'
  group by direction, is_active
  union all
  select direction, 'bollinger_pctb', is_active::text, count(*), count(*) filter (where outcome = direction), null::numeric
  from research_regime_signal_activation
  where signal_a = 'Bollinger %b (Mean-Reversion)' and direction = 'UP'
  group by direction, is_active
  union all
  select direction, 'dxy', is_active::text, count(*), count(*) filter (where outcome = direction), null::numeric
  from research_regime_signal_activation
  where signal_a = 'DXY-Bewegung'
  group by direction, is_active
  union all
  select direction, 'cci', is_active::text, count(*), count(*) filter (where outcome = direction), null::numeric
  from research_regime_signal_activation
  where signal_a = 'CCI-Extrem (Fortsetzung)'
  group by direction, is_active
  union all
  select direction, 'fragile_bullish', is_active::text, count(*), count(*) filter (where outcome = direction), null::numeric
  from research_regime_signal_activation
  where signal_a = 'Fragile Bullish' and direction = 'UP'
  group by direction, is_active;

  update research_regime_score_woe w
  set woe = research_logit(least(greatest(w.x::numeric / nullif(w.n,0), 0.001), 0.999))
           - research_logit(case when w.direction = 'UP' then v_base_up else v_base_down end)
  where w.n > 0;

  -- Terzil-Grenzen je Richtung ueber den kombinierten Logit aller Bewertungspunkte.
  insert into research_regime_score_tiers (direction, base_logit, tier_low_max, tier_mid_max, n_total)
  select 'UP', research_logit(v_base_up),
    percentile_cont(0.3333) within group (order by combined_logit),
    percentile_cont(0.6667) within group (order by combined_logit),
    v_n_total
  from (
    select
      research_logit(v_base_up)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='trend_konsens' and level = s.konsens::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='cvd_z' and level = s.cvdz::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='bollinger_pctb' and level = s.bb::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='dxy' and level = s.dxy::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='cci' and level = s.cci::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='fragile_bullish' and level = s.fb::text), 0)
      as combined_logit
    from (
      select e.evaluation_time,
        sum(case when a.signal_a = any(v_trend_signals) and a.direction='UP' and a.is_active then 1 else 0 end) as konsens,
        bool_or(a.is_active) filter (where a.signal_a = 'CVD-Z-Score' and a.direction='UP') as cvdz,
        bool_or(a.is_active) filter (where a.signal_a = 'Bollinger %b (Mean-Reversion)' and a.direction='UP') as bb,
        bool_or(a.is_active) filter (where a.signal_a = 'DXY-Bewegung' and a.direction='UP') as dxy,
        bool_or(a.is_active) filter (where a.signal_a = 'CCI-Extrem (Fortsetzung)' and a.direction='UP') as cci,
        bool_or(a.is_active) filter (where a.signal_a = 'Fragile Bullish' and a.direction='UP') as fb
      from research_regime_evaluation_events() e
      join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
      group by e.evaluation_time
    ) s
  ) t;

  insert into research_regime_score_tiers (direction, base_logit, tier_low_max, tier_mid_max, n_total)
  select 'DOWN', research_logit(v_base_down),
    percentile_cont(0.3333) within group (order by combined_logit),
    percentile_cont(0.6667) within group (order by combined_logit),
    v_n_total
  from (
    select
      research_logit(v_base_down)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='trend_konsens' and level = s.konsens::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='cvd_z' and level = s.cvdz::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='momentum' and level = s.mom::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='dxy' and level = s.dxy::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='cci' and level = s.cci::text), 0)
      as combined_logit
    from (
      select e.evaluation_time,
        sum(case when a.signal_a = any(v_trend_signals) and a.direction='DOWN' and a.is_active then 1 else 0 end) as konsens,
        bool_or(a.is_active) filter (where a.signal_a = 'CVD-Z-Score' and a.direction='DOWN') as cvdz,
        bool_or(a.is_active) filter (where a.signal_a = 'Momentum-Faktor (RSI+MACD)' and a.direction='DOWN') as mom,
        bool_or(a.is_active) filter (where a.signal_a = 'DXY-Bewegung' and a.direction='DOWN') as dxy,
        bool_or(a.is_active) filter (where a.signal_a = 'CCI-Extrem (Fortsetzung)' and a.direction='DOWN') as cci
      from research_regime_evaluation_events() e
      join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
      group by e.evaluation_time
    ) s
  ) t;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_rsi_reversal_backtest(p_interval text, p_rsi_upper numeric, p_rsi_lower numeric, p_definition text, p_n_confirm integer DEFAULT 2, p_tp_pct numeric DEFAULT 0.015, p_sl_pct numeric DEFAULT 0.005, p_max_hours numeric DEFAULT 48, p_train_end timestamp with time zone DEFAULT '2026-01-14 00:00:00+00'::timestamp with time zone, p_val_end timestamp with time zone DEFAULT '2026-05-14 00:00:00+00'::timestamp with time zone, p_test_start timestamp with time zone DEFAULT '2026-05-15 00:00:00+00'::timestamp with time zone)
 RETURNS TABLE(split text, direction text, n_signals integer, n_tp integer, n_sl integer, n_timeout integer)
 LANGUAGE plpgsql
AS $function$
declare
  rsi_period constant int := 14;
  n int := 0;
  i int;
  j int;
  k int;
  bars_time timestamptz[];
  bars_open numeric[];
  bars_high numeric[];
  bars_low numeric[];
  bars_close numeric[];
  bars_rsi numeric[];
  pat_dir text[];
  avg_gain numeric;
  avg_loss numeric;
  diff numeric;
  data_end timestamptz;
  entry_idx int;
  entry_time timestamptz;
  entry_price numeric;
  tp_price numeric;
  sl_price numeric;
  deadline timestamptz;
  dir text;
  outcome text;
  hit_sl boolean;
  hit_tp boolean;
  confirmed boolean;
  sig_split text;
  rec record;
  cnt_n int[3][2] := array_fill(0, array[3,2]);
  cnt_tp int[3][2] := array_fill(0, array[3,2]);
  cnt_sl int[3][2] := array_fill(0, array[3,2]);
  cnt_to int[3][2] := array_fill(0, array[3,2]);
  split_idx int;
  dir_idx int;
  horizon interval;
begin
  horizon := make_interval(hours => p_max_hours::int);
  drop table if exists tmp_bars;
  create temp table tmp_bars(idx int primary key, open_time timestamptz);

  i := 0;
  for rec in
    select open_time, open, high, low, close
    from candles
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = p_interval
    order by open_time asc
  loop
    i := i + 1;
    bars_time[i] := rec.open_time;
    bars_open[i] := rec.open;
    bars_high[i] := rec.high;
    bars_low[i]  := rec.low;
    bars_close[i] := rec.close;
    insert into tmp_bars values (i, rec.open_time);
  end loop;
  n := i;
  if n <= rsi_period + 2 then
    drop table if exists tmp_bars;
    return;
  end if;
  data_end := bars_time[n];

  bars_rsi := array_fill(null::numeric, array[n]);
  avg_gain := 0; avg_loss := 0;
  for i in 2..(rsi_period+1) loop
    diff := bars_close[i] - bars_close[i-1];
    if diff >= 0 then avg_gain := avg_gain + diff; else avg_loss := avg_loss - diff; end if;
  end loop;
  avg_gain := avg_gain / rsi_period;
  avg_loss := avg_loss / rsi_period;
  bars_rsi[rsi_period+1] := case when avg_loss = 0 then 100 else 100 - 100/(1+avg_gain/avg_loss) end;
  for i in (rsi_period+2)..n loop
    diff := bars_close[i] - bars_close[i-1];
    if diff > 0 then
      avg_gain := (avg_gain*(rsi_period-1) + diff) / rsi_period;
      avg_loss := (avg_loss*(rsi_period-1)) / rsi_period;
    else
      avg_gain := (avg_gain*(rsi_period-1)) / rsi_period;
      avg_loss := (avg_loss*(rsi_period-1) + (-diff)) / rsi_period;
    end if;
    bars_rsi[i] := case when avg_loss = 0 then 100 else 100 - 100/(1+avg_gain/avg_loss) end;
  end loop;

  if p_definition = 'pattern' then
    pat_dir := array_fill(null::text, array[n]);
    for rec in
      select tb.idx, p.direction_expected
      from public.research_detect_candlestick_patterns(p_interval) p
      join tmp_bars tb on tb.open_time = p.candle_open_time
    loop
      pat_dir[rec.idx] := rec.direction_expected;
    end loop;
  end if;

  drop table if exists tmp_bars;

  i := rsi_period + 1;
  while i <= n loop
    dir := null;
    entry_idx := null;

    if p_definition = 'pattern' then
      if bars_rsi[i] is not null then
        if bars_rsi[i] >= p_rsi_upper and pat_dir[i] = 'BEARISH' then
          dir := 'SHORT'; entry_idx := i + 1;
        elsif bars_rsi[i] <= p_rsi_lower and pat_dir[i] = 'BULLISH' then
          dir := 'LONG'; entry_idx := i + 1;
        end if;
      end if;
    else
      if bars_rsi[i] is not null and bars_rsi[i-1] is not null then
        if bars_rsi[i] >= p_rsi_upper and bars_rsi[i-1] < p_rsi_upper and i + p_n_confirm <= n then
          confirmed := true;
          for k in 1..p_n_confirm loop
            if bars_close[i+k] >= bars_close[i+k-1] then confirmed := false; end if;
          end loop;
          if confirmed then dir := 'SHORT'; entry_idx := i + p_n_confirm + 1; end if;
        elsif bars_rsi[i] <= p_rsi_lower and bars_rsi[i-1] > p_rsi_lower and i + p_n_confirm <= n then
          confirmed := true;
          for k in 1..p_n_confirm loop
            if bars_close[i+k] <= bars_close[i+k-1] then confirmed := false; end if;
          end loop;
          if confirmed then dir := 'LONG'; entry_idx := i + p_n_confirm + 1; end if;
        end if;
      end if;
    end if;

    if dir is not null and entry_idx is not null and entry_idx <= n then
      entry_time := bars_time[entry_idx];
      entry_price := bars_open[entry_idx];
      deadline := entry_time + horizon;

      if deadline <= data_end then
        if dir = 'LONG' then
          tp_price := entry_price * (1 + p_tp_pct);
          sl_price := entry_price * (1 - p_sl_pct);
        else
          tp_price := entry_price * (1 - p_tp_pct);
          sl_price := entry_price * (1 + p_sl_pct);
        end if;

        outcome := 'TIMEOUT';
        j := entry_idx;
        while j <= n and bars_time[j] <= deadline loop
          if dir = 'LONG' then
            hit_sl := bars_low[j] <= sl_price;
            hit_tp := bars_high[j] >= tp_price;
          else
            hit_sl := bars_high[j] >= sl_price;
            hit_tp := bars_low[j] <= tp_price;
          end if;
          if hit_sl then outcome := 'SL'; exit; end if;
          if hit_tp then outcome := 'TP'; exit; end if;
          j := j + 1;
        end loop;

        sig_split := null;
        if entry_time < p_train_end and (entry_time + horizon) <= p_train_end then
          sig_split := 'train';
        elsif entry_time >= p_train_end and entry_time < p_val_end
              and (entry_time + horizon) <= p_test_start then
          sig_split := 'validation';
        elsif entry_time >= p_test_start then
          sig_split := 'test';
        end if;

        if sig_split is not null then
          split_idx := case sig_split when 'train' then 1 when 'validation' then 2 else 3 end;
          dir_idx := case dir when 'LONG' then 1 else 2 end;
          cnt_n[split_idx][dir_idx] := cnt_n[split_idx][dir_idx] + 1;
          if outcome = 'TP' then cnt_tp[split_idx][dir_idx] := cnt_tp[split_idx][dir_idx] + 1;
          elsif outcome = 'SL' then cnt_sl[split_idx][dir_idx] := cnt_sl[split_idx][dir_idx] + 1;
          else cnt_to[split_idx][dir_idx] := cnt_to[split_idx][dir_idx] + 1;
          end if;
        end if;
      end if;
    end if;

    i := i + 1;
  end loop;

  for split_idx in 1..3 loop
    for dir_idx in 1..2 loop
      split := case split_idx when 1 then 'train' when 2 then 'validation' else 'test' end;
      direction := case dir_idx when 1 then 'LONG' else 'SHORT' end;
      n_signals := cnt_n[split_idx][dir_idx];
      n_tp := cnt_tp[split_idx][dir_idx];
      n_sl := cnt_sl[split_idx][dir_idx];
      n_timeout := cnt_to[split_idx][dir_idx];
      return next;
    end loop;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.research_sigmoid(l numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select 100.0 / (1 + exp(-l));
$function$;

CREATE OR REPLACE FUNCTION public.research_swing_setup_chain_events(p_interval text, p_direction text, p_tp_pct numeric, p_sl_pct numeric, p_retrace_pct numeric, p_vertical_bars integer, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(signal_time timestamp with time zone, entry_time timestamp with time zone, entry_price numeric, outcome text, resolution_time timestamp with time zone, bars_to_resolution integer, mfe_pct numeric)
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.research_swing_setup_events(p_interval text, p_direction text, p_tp_pct numeric, p_sl_pct numeric, p_retrace_pct numeric, p_vertical_bars integer, p_signal_start timestamp with time zone DEFAULT '-infinity'::timestamp with time zone, p_signal_end timestamp with time zone DEFAULT 'infinity'::timestamp with time zone)
 RETURNS TABLE(signal_time timestamp with time zone, entry_time timestamp with time zone, entry_price numeric, outcome text, resolution_time timestamp with time zone, bars_to_resolution integer, mfe_pct numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
    window w as (order by open_time)
  ),
  b as (
    select * from base
    where entry_time is not null
      and signal_time >= p_signal_start and signal_time < p_signal_end
  ),
  ts as (
    select b.*,
      case when p_direction = 'LONG' then b.entry_price * (1 + p_tp_pct/100.0) else b.entry_price * (1 - p_tp_pct/100.0) end as tp_price,
      case when p_direction = 'LONG' then b.entry_price * (1 - p_sl_pct/100.0) else b.entry_price * (1 + p_sl_pct/100.0) end as sl_price
    from b
  ),
  first_touch as (
    select ts.*, touch.open_time as touch_time, touch.high as touch_high, touch.low as touch_low
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
    ) touch on true
  ),
  stage1 as (
    select *,
      case
        when touch_time is null then 'TIMEOUT'
        when p_direction = 'LONG' and touch_low <= sl_price then 'SL'
        when p_direction = 'SHORT' and touch_high >= sl_price then 'SL'
        else 'TP_TOUCHED'
      end as stage1_outcome
    from first_touch
  ),
  with_trail as (
    select st.*, trail.exit_time, trail.exit_peak, trail.is_retrace
    from stage1 st
    left join lateral (
      with windowed as (
        select c.open_time, c.high, c.low,
          max(c.high) over (order by c.open_time) as peak_high,
          min(c.low) over (order by c.open_time) as peak_low
        from candles c, bar_duration
        where st.stage1_outcome = 'TP_TOUCHED'
          and c.symbol = 'BTCUSDT' and c.interval = p_interval
          and c.open_time >= st.touch_time
          and c.open_time < st.entry_time + p_vertical_bars * bar_duration.d
      ),
      picked as (
        (
          select open_time,
            case when p_direction = 'LONG' then peak_high else peak_low end as peak,
            true as is_retrace
          from windowed
          where (p_direction = 'LONG' and low <= peak_high * (1 - p_retrace_pct/100.0))
             or (p_direction = 'SHORT' and high >= peak_low * (1 + p_retrace_pct/100.0))
          order by open_time
          limit 1
        )
        union all
        (
          select open_time,
            case when p_direction = 'LONG' then peak_high else peak_low end as peak,
            false as is_retrace
          from windowed
          order by open_time desc
          limit 1
        )
      )
      select open_time, peak, is_retrace from picked order by is_retrace desc limit 1
    ) trail(exit_time, exit_peak, is_retrace) on true
  )
  select
    signal_time, entry_time, entry_price,
    case
      when stage1_outcome in ('SL','TIMEOUT') then stage1_outcome
      when is_retrace then 'TRAIL_EXIT'
      else 'OPEN_AT_HORIZON'
    end as outcome,
    coalesce(exit_time, touch_time) as resolution_time,
    case when coalesce(exit_time, touch_time) is not null
      then round(extract(epoch from (coalesce(exit_time, touch_time) - entry_time)) / extract(epoch from (select d from bar_duration)))::int
      else null
    end as bars_to_resolution,
    case
      when stage1_outcome = 'SL' then case when p_direction='LONG' then (touch_low/entry_price - 1)*100 else (1 - touch_high/entry_price)*100 end
      when stage1_outcome = 'TIMEOUT' then null
      when exit_peak is not null then case when p_direction='LONG' then (exit_peak/entry_price - 1)*100 else (1 - exit_peak/entry_price)*100 end
      else null
    end as mfe_pct
  from with_trail;
$function$;

CREATE OR REPLACE FUNCTION public.research_triple_barrier_events(p_interval text, p_direction text, p_tp_pct numeric, p_sl_pct numeric, p_vertical_bars integer)
 RETURNS TABLE(signal_time timestamp with time zone, entry_time timestamp with time zone, entry_price numeric, outcome text, resolution_time timestamp with time zone, bars_to_resolution integer)
 LANGUAGE sql
 STABLE
AS $function$
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
    window w as (order by open_time)
  ),
  b as (select * from base where entry_time is not null),
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
$function$;

CREATE OR REPLACE FUNCTION public.research_triple_barrier_events(p_interval text, p_direction text, p_tp_pct numeric, p_sl_pct numeric, p_vertical_bars integer, p_signal_start timestamp with time zone DEFAULT '-infinity'::timestamp with time zone, p_signal_end timestamp with time zone DEFAULT 'infinity'::timestamp with time zone)
 RETURNS TABLE(signal_time timestamp with time zone, entry_time timestamp with time zone, entry_price numeric, outcome text, resolution_time timestamp with time zone, bars_to_resolution integer)
 LANGUAGE sql
 STABLE
AS $function$
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
    where exchange = 'binance' and symbol = 'BTCUSDT' and interval = p_interval
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
    where c.exchange = 'binance' and c.symbol = 'BTCUSDT' and c.interval = p_interval
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
$function$;

CREATE OR REPLACE FUNCTION public.research_two_proportion_ztest(p_x1 integer, p_n1 integer, p_x2 integer, p_n2 integer)
 RETURNS TABLE(p1 numeric, p2 numeric, z_score numeric, raw_p_value numeric)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with base as (
    select
      p_x1::numeric / nullif(p_n1,0) as phat1,
      p_x2::numeric / nullif(p_n2,0) as phat2,
      (p_x1 + p_x2)::numeric / nullif(p_n1 + p_n2, 0) as pbar
  ),
  se as (
    select *,
      case when p_n1 > 0 and p_n2 > 0 then sqrt(pbar*(1-pbar)*(1.0/p_n1 + 1.0/p_n2)) else null end as se_val
    from base
  )
  select
    phat1, phat2,
    case when se_val > 0 then (phat1 - phat2) / se_val else null end,
    case when se_val > 0 then 2 * (1 - public.research_norm_cdf(abs((phat1 - phat2) / se_val))) else null end
  from se;
$function$;

CREATE OR REPLACE FUNCTION public.research_wilson_ci(p_x integer, p_n integer, p_z numeric DEFAULT 1.959963985)
 RETURNS TABLE(lower numeric, upper numeric)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with base as (
    select p_x::numeric / nullif(p_n,0) as phat
  )
  select
    case when p_n = 0 then null else
      (phat + p_z^2/(2*p_n) - p_z*sqrt(phat*(1-phat)/p_n + p_z^2/(4*p_n^2))) / (1 + p_z^2/p_n)
    end,
    case when p_n = 0 then null else
      (phat + p_z^2/(2*p_n) + p_z*sqrt(phat*(1-phat)/p_n + p_z^2/(4*p_n^2))) / (1 + p_z^2/p_n)
    end
  from base;
$function$;

CREATE OR REPLACE FUNCTION public.run_core_engine_outcomes_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  cnt_before int;
  cnt_after int;
  bad_count int;
  bullish_active_rows int;
  bullish_instances int;
begin
  return next plan(7);

  select count(*) into cnt_before from public.signal_outcomes where category = 'core_engine';
  perform public.detect_overall_state_outcomes();
  perform public.detect_regime_matrix_outcomes();
  select count(*) into cnt_after from public.signal_outcomes where category = 'core_engine';
  return next is(cnt_after, cnt_before, 'Wiederholter Kern-Engine-Detection-Lauf ist idempotent');

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bullish' and direction_expected <> 'bullish';
  return next is(bad_count, 0, 'overall_state_bullish hat immer direction_expected=bullish');

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bearish' and direction_expected <> 'bearish';
  return next is(bad_count, 0, 'overall_state_bearish hat immer direction_expected=bearish');

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type like 'regime_matrix_%'
    and direction_expected is distinct from replace(signal_type, 'regime_matrix_', '');
  return next is(bad_count, 0, 'regime_matrix_bullish/bearish hat immer die passende direction_expected');

  select count(*) into bullish_active_rows from public.market_states where overall_state = 'BULLISH';
  select count(*) into bullish_instances
  from public.signal_outcomes
  where category = 'core_engine' and signal_type = 'overall_state_bullish' and horizon_hours = 4;
  return next cmp_ok(
    bullish_instances, '<', bullish_active_rows,
    'Transition-Erkennung zaehlt eine BULLISH-Phase einmal, nicht pro 15-Min-Zeile'
  );

  return next lives_ok(
    'select public.compute_signal_stats(''90d'')',
    'compute_signal_stats() scheitert nicht an bullish/bearish-Kollision (Regressionstest)'
  );

  select count(*) into bad_count
  from public.signal_outcomes
  where category = 'core_engine' and signal_type like 'regime_matrix_%' and price_at_signal is null;
  return next is(bad_count, 0, 'regime_matrix-Signale haben nie einen NULL-Preis (LEFT JOIN korrekt gefiltert)');

  return next finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_data_quality_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
begin
  return query select plan(11);

  return query select results_eq(
    $q$select status from public._dq_evaluate(null, null, 300, 3, 0.0, 0.0, false)$q$,
    array['UNKNOWN'],
    'UNKNOWN wenn last_success_at NULL ist'
  );

  return query select results_eq(
    $q$select quality_score is null from public._dq_evaluate(null, null, 300, 3, 0.0, 0.0, false)$q$,
    array[true],
    'quality_score ist NULL bei UNKNOWN, nicht 0 oder erfunden'
  );

  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.0, 0.0, true)$q$,
    array['ERROR'],
    'ERROR hat Vorrang vor sonst perfektem Score, wenn juengster Versuch fehlschlug'
  );

  return query select results_eq(
    format($q$select status from public._dq_evaluate(now() - interval '2 hours', now() - interval '2 hours', %L, %L, 0.0, 0.0, false)$q$, 300, 3),
    array['STALE'],
    'STALE wenn Alter weit ueber expected_interval * staleness_multiplier liegt'
  );

  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 0.0, 0.0, false)$q$,
    array['VALIDATED'],
    'VALIDATED bei frischen, fehlerfreien Daten ohne Luecken'
  );

  return query select results_eq(
    $q$select status from public._dq_evaluate(now(), now(), 300, 3, 1.0, 1.0, false)$q$,
    array['DEGRADED'],
    'DEGRADED bei score < 60 (100% Fehler-/Luecken-Rate im Fenster, aber juengster Einzelversuch kein Fehler)'
  );

  return query select ok(
    (select quality_score >= 0 and quality_score <= 100
     from public._dq_evaluate(now(), now(), 300, 3, 1.0, 1.0, false)),
    'quality_score bleibt bei Extremwerten innerhalb 0-100'
  );

  return query select cmp_ok(
    (select quality_score from public._dq_evaluate(now() - interval '30 seconds', now() - interval '30 seconds', 300, 3, 0.0, 0.0, false)),
    '=', 100.00::numeric,
    'volle 100 Punkte, wenn Alter klar innerhalb expected_interval liegt'
  );

  return query select ok(
    (select bool_and(status = any(array['LIVE','VALIDATED','DEGRADED','STALE','ERROR','UNKNOWN'])) from public.data_quality),
    'alle data_quality.status-Werte sind gueltige Enum-Werte'
  );

  return query select is(
    (select count(*)::int from public.data_quality),
    (select (select count(*)::int from public.data_quality) from (select public.refresh_data_quality()) x),
    'refresh_data_quality() erzeugt bei wiederholtem Aufruf keine Duplikate (Zeilenanzahl bleibt gleich)'
  );

  return query select is(
    (select count(*)::int from pg_proc where proname = '_dq_evaluate' and pronargs = 7),
    1,
    '_dq_evaluate hat exakt 7 Parameter (Frische/Fehler/Luecken) -- keinerlei Confidence-Bezug in der Signatur'
  );

  return query select * from finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_defensive_coverage_rule_test()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  v_baseline jsonb; v_domain jsonb; v_calib jsonb;
begin
  return next plan(3);
  select public.baseline_signal_state('{}'::jsonb) into v_baseline;
  return next is(v_baseline->>'overall_state', 'INSUFFICIENT_DATA', 'Model A: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL (Phase-6 Section 5)');
  select public.experimental_domain_signal_state('{}'::jsonb) into v_domain;
  return next is(v_domain->>'overall_state', 'INSUFFICIENT_DATA', 'Model B: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');
  select public.calibrated_v1_signal_state('{}'::jsonb) into v_calib;
  return next is(v_calib->>'overall_state', 'INSUFFICIENT_DATA', 'Model C: 0 Faktoren -> INSUFFICIENT_DATA, niemals NEUTRAL');
  return next finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_divergence_radar_outcomes_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  id1 bigint;
  id2 bigint;
  id3 bigint;
  id4 bigint;
  cnt int;
  st text;
  dir text;
begin
  return next plan(11);

  -- Fixtures: zwei aufeinanderfolgende Snapshots mit identischem
  -- spot_pressure_vs_price -- nur der erste darf ein Signal feuern
  -- (Anti-Spam-Transitionserkennung).
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price)
  values (79000, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'ABSORPTION_BULLISH',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE')
  returning id into id1;
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price)
  values (79050, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'ABSORPTION_BULLISH',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE')
  returning id into id2;

  perform public.detect_spot_pressure_absorption_outcomes();

  select count(*) into cnt from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id in (id1::text, id2::text);
  return next is(cnt, 3, 'Nur der ERSTE von zwei identischen ABSORPTION_BULLISH-Snapshots feuert (3 = 1 Instanz x 3 Horizonte)');

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id1::text and horizon_hours = 4;
  return next is(st, 'spot_pressure_absorption_bullish', 'ABSORPTION_BULLISH -> signal_type spot_pressure_absorption_bullish');
  return next is(dir, 'bullish', 'ABSORPTION_BULLISH -> direction_expected bullish');

  -- Onchain-vs-Preis: PRICE_HIGH_SOPR_LOSS -> bearish.
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price)
  values (81000, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'PRICE_HIGH_SOPR_LOSS')
  returning id into id3;

  perform public.detect_onchain_vs_price_outcomes();

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id3::text and horizon_hours = 4;
  return next is(st, 'onchain_vs_price_bearish', 'PRICE_HIGH_SOPR_LOSS -> signal_type onchain_vs_price_bearish');
  return next is(dir, 'bearish', 'PRICE_HIGH_SOPR_LOSS -> direction_expected bearish');

  delete from public.signal_outcomes where source_table = 'divergence_radar_snapshots' and source_id = id3::text;
  delete from public.divergence_radar_snapshots where id = id3;

  -- RSI/MACD-Divergenz vs. Trendkontext: bullish + GEGEN_INTAKTEN_TREND.
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     rsi_macd_divergence_direction, onchain_vs_price)
  values (79500, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'GEGEN_INTAKTEN_TREND', 'bullish', 'NOT_COMPARABLE')
  returning id into id3;

  perform public.detect_rsi_divergence_vs_trend_outcomes();

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id3::text and horizon_hours = 4;
  return next is(st, 'rsi_divergence_bullish_gegentrend', 'bullish+GEGEN_INTAKTEN_TREND -> signal_type rsi_divergence_bullish_gegentrend');
  return next is(dir, 'bullish', 'bullish+GEGEN_INTAKTEN_TREND -> direction_expected bullish');

  -- Spot-Pressure vs. Orderbuch: RESISTANCE_AHEAD -> bearish.
  insert into public.divergence_radar_snapshots
    (price, overall_state, options_vs_sentiment, spot_vs_futures, spot_pressure_vs_price,
     cycle_vs_momentum, handelslage_vs_state, tradingview_vs_state, rsi_divergence_vs_trend,
     onchain_vs_price, spot_pressure_vs_orderbook)
  values (80200, 'MIXED', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE', 'NOT_COMPARABLE',
          'RESISTANCE_AHEAD')
  returning id into id4;

  perform public.detect_spot_pressure_vs_orderbook_outcomes();

  select signal_type, direction_expected into st, dir from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id = id4::text and horizon_hours = 4;
  return next is(st, 'spot_pressure_orderbook_resistance', 'RESISTANCE_AHEAD -> signal_type spot_pressure_orderbook_resistance');
  return next is(dir, 'bearish', 'RESISTANCE_AHEAD -> direction_expected bearish');

  -- Idempotenz: zweiter Lauf ohne neue Snapshots aendert nichts.
  select count(*) into cnt from public.signal_outcomes;
  perform public.detect_spot_pressure_absorption_outcomes();
  perform public.detect_onchain_vs_price_outcomes();
  perform public.detect_rsi_divergence_vs_trend_outcomes();
  perform public.detect_spot_pressure_vs_orderbook_outcomes();
  return next is(
    (select count(*)::int from public.signal_outcomes), cnt,
    'Wiederholter Divergenz-Radar-Detection-Lauf ist idempotent'
  );

  -- Aufraeumen -- Test-Fixtures duerfen keine echten Daten verunreinigen.
  delete from public.signal_outcomes
  where source_table = 'divergence_radar_snapshots' and source_id in (id1::text, id2::text, id3::text, id4::text);
  delete from public.divergence_radar_snapshots where id in (id1, id2, id3, id4);

  select count(*)::int into cnt from public.divergence_radar_snapshots where id in (id1, id2, id3, id4);
  return next is(cnt, 0, 'Test-Fixtures vollstaendig aufgeraeumt');

  return next finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_signal_architecture_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  full_factors jsonb;
  redundant_factors jsonb;
  partial_factors jsonb;
  r1 jsonb;
  r2 jsonb;
  expected_names text[] := array[
    'structure','momentum','cvd','oi_price','positioning','orderbook','options',
    'macro','funding','sentiment','trend_strength','trend_regime','vwap_position','basis'
  ];
  mapped_count int;
begin
  return next plan(9);

  -- 1) Alle 14 tatsaechlichen Faktor-Namen aus compute-market-state sind im
  --    Domain-Mapping vertreten (kein Faktor faellt durch die Analyse).
  select count(*) into mapped_count
  from unnest(expected_names) fn
  where exists (
    select 1 from jsonb_each(
      public.experimental_domain_signal_state(
        (select jsonb_object_agg(n, jsonb_build_object('value', 1)) from unnest(expected_names) n)
      ) -> 'domain_scores'
    )
  );
  return next ok(
    (select bool_and(fn = any(expected_names)) from unnest(expected_names) fn),
    'Domain-Mapping deckt alle 14 realen Faktor-Namen ab (kein blindes Uebernehmen fremder Namen)'
  );

  -- 2) Voller Datensatz (alle 14 Faktoren bullish) -> BULLISH, volle Coverage.
  full_factors := (select jsonb_object_agg(n, jsonb_build_object('value', 1)) from unnest(expected_names) n);
  r1 := public.experimental_domain_signal_state(full_factors);
  return next is((r1->>'domain_coverage_pct')::numeric, 100.0, 'Volle Faktorenbasis -> 100% Domain-Coverage');
  return next is(r1->>'overall_state', 'BULLISH', 'Volle Faktorenbasis, alle bullish -> BULLISH');

  -- 3) Fehlende Faktoren: leeres jsonb -> INSUFFICIENT_DATA, confidence=0
  --    (keine Daten != neutral, gleiche Philosophie wie compute-market-state).
  r1 := public.experimental_domain_signal_state('{}'::jsonb);
  return next is(r1->>'overall_state', 'INSUFFICIENT_DATA', 'Keine Faktoren -> INSUFFICIENT_DATA');
  return next is((r1->>'confidence')::int, 0, 'Keine Faktoren -> confidence=0 (kein erfundenes Vertrauen)');

  -- 4) Redundanz-Test: alle 4 derivatives_leverage-Faktoren (funding, basis,
  --    oi_price, positioning) zeigen bullish. Domain-Mittelung MUSS das als
  --    EINEN Domain-Score von 1 zaehlen, nicht als Summe von 4 -- das ist
  --    genau der Mechanismus, der verhindert, dass ein einzelnes
  --    Leverage-/Crowding-Phaenomen vierfach als unabhaengige Bestaetigung
  --    gezaehlt wird.
  redundant_factors := jsonb_build_object(
    'funding', jsonb_build_object('value', 1),
    'basis', jsonb_build_object('value', 1),
    'oi_price', jsonb_build_object('value', 1),
    'positioning', jsonb_build_object('value', 1)
  );
  r1 := public.experimental_domain_signal_state(redundant_factors);
  return next is(
    ((r1->'domain_scores'->'derivatives_leverage'->>'score')::numeric), 1.0,
    'Vier gleichgerichtete Derivatives/Leverage-Faktoren ergeben einen Domain-Score von 1, nicht 4 (Redundanz-Schutz)'
  );
  return next is(
    (r1->>'weighted_score')::numeric, 1.0,
    'Gesamt-Score zaehlt die redundante Domain nur einmal (1.0), nicht die Summe der 4 Einzelfaktoren (4.0)'
  );

  -- 5) Unvollstaendige Faktorenbasis: nur 3 von 14 Faktoren vorhanden ->
  --    Coverage darf NICHT 100% sein und muss unter dem Schwellenwert fuer
  --    INSUFFICIENT_DATA liegen (3/7 Domains ~= 43%, >= 40% Schwelle, damit
  --    kein INSUFFICIENT_DATA, aber klar sichtbar unvollstaendig).
  partial_factors := jsonb_build_object(
    'structure', jsonb_build_object('value', 1),
    'cvd', jsonb_build_object('value', 1),
    'macro', jsonb_build_object('value', 0)
  );
  r1 := public.experimental_domain_signal_state(partial_factors);
  return next cmp_ok((r1->>'domain_coverage_pct')::numeric, '<', 100.0, 'Unvollstaendige Faktorenbasis -> Coverage < 100%');

  -- 6) Determinismus: zweimaliger Aufruf mit identischem Input liefert
  --    identisches Ergebnis (reine Funktion, kein verstecktter Zustand).
  r1 := public.experimental_domain_signal_state(full_factors);
  r2 := public.experimental_domain_signal_state(full_factors);
  return next is(r1, r2, 'Deterministische Berechnung: gleicher Input -> exakt gleicher Output');

  return next finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_signal_outcomes_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  cnt_before int;
  cnt_after int;
  fragile_instances int;
  fragile_active_rows int;
  bad_hit_count int;
  bad_return_count int;
  premature_fill_count int;
  dup_count int;
begin
  return next plan(21);

  return next is(public.tv_infer_signal_direction('FAIR_VALUE_GAP_BULLISH'), 'bullish', 'FVG bullish -> bullish');
  return next is(public.tv_infer_signal_direction('ORDER_BLOCK_BEARISH'), 'bearish', 'Order Block bearish -> bearish');
  return next is(public.tv_infer_signal_direction('VOLUME_EXPANSION_BULL'), 'bullish', '_BULL-Kurzform -> bullish');
  return next is(public.tv_infer_signal_direction('VOLUME_EXPANSION_BEAR'), 'bearish', '_BEAR-Kurzform -> bearish');
  return next is(public.tv_infer_signal_direction('LIQUIDITY_SWEEP_LOW'), 'bullish', 'Sweep tief = bullischer Reversal-Hinweis');
  return next is(public.tv_infer_signal_direction('LIQUIDITY_SWEEP_HIGH'), 'bearish', 'Sweep hoch = baerischer Reversal-Hinweis');
  return next is(public.tv_infer_signal_direction('VWAP_STRETCH_LO'), 'bullish', 'VWAP-Stretch tief = bullischer Erschoepfungs-Hinweis');
  return next is(public.tv_infer_signal_direction('VWAP_STRETCH_HI'), 'bearish', 'VWAP-Stretch hoch = baerischer Erschoepfungs-Hinweis');
  return next is(public.tv_infer_signal_direction('SOME_FUTURE_SIGNAL'), null, 'Unbekannter Typ -> NULL statt geratener Richtung');
  return next is(public.tv_infer_signal_direction('fair_value_gap_bullish'), 'bullish', 'Gross-/Kleinschreibungs-unabhaengig');

  select count(*) into cnt_before from public.signal_outcomes;
  perform public.detect_tradingview_signal_outcomes();
  perform public.detect_warning_pattern_outcomes();
  perform public.detect_risk_factor_outcomes();
  select count(*) into cnt_after from public.signal_outcomes;
  return next is(cnt_after, cnt_before, 'Wiederholter Detection-Lauf ohne neue Quellzeilen ist idempotent (keine Duplikate)');

  insert into public.signal_outcomes
    (category, signal_type, direction_expected, fired_at, price_at_signal, horizon_hours, source_table, source_id)
  values
    ('test_fixture', 'signal_a', 'bullish', now() - interval '1 hour', 100, 4, 'test_fixture', 'shared-id'),
    ('test_fixture', 'signal_b', 'bearish', now() - interval '1 hour', 100, 4, 'test_fixture', 'shared-id')
  on conflict (source_table, source_id, signal_type, horizon_hours) do nothing;
  select count(*) into cnt_after from public.signal_outcomes where source_table = 'test_fixture';
  return next is(cnt_after, 2, 'Zwei Signal-Typen an derselben source_id kollidieren NICHT mehr (Bugfix-Regressionstest)');
  delete from public.signal_outcomes where source_table = 'test_fixture';

  select count(*) into fragile_active_rows
  from public.market_states
  where exists (select 1 from jsonb_array_elements(patterns) e where e->>'name' = 'Fragile Bullish');
  select count(*) into fragile_instances
  from public.signal_outcomes
  where category = 'warning_pattern' and signal_type = 'Fragile Bullish' and horizon_hours = 4;
  return next cmp_ok(
    fragile_instances, '<', fragile_active_rows,
    'Transition-Erkennung zaehlt eine zusammenhaengende Aktiv-Phase einmal, nicht pro 15-Min-Zeile'
  );

  select count(*) into bad_return_count
  from public.signal_outcomes
  where filled_at is not null
    and abs(return_pct - ((outcome_price - price_at_signal) / price_at_signal) * 100) > 0.0001;
  return next is(bad_return_count, 0, 'return_pct entspricht ueberall der Formel (outcome-price)/price*100');

  select count(*) into bad_hit_count
  from public.signal_outcomes
  where filled_at is not null and direction_expected = 'bullish' and hit is distinct from (outcome_price > price_at_signal);
  return next is(bad_hit_count, 0, 'hit=bullish stimmt ueberall mit outcome_price > price_at_signal ueberein');

  select count(*) into bad_hit_count
  from public.signal_outcomes
  where filled_at is not null and direction_expected = 'bearish' and hit is distinct from (outcome_price < price_at_signal);
  return next is(bad_hit_count, 0, 'hit=bearish stimmt ueberall mit outcome_price < price_at_signal ueberein');

  select count(*) into bad_hit_count
  from public.signal_outcomes
  where filled_at is not null and direction_expected is null and hit is not null;
  return next is(bad_hit_count, 0, 'hit bleibt NULL, wenn direction_expected NULL ist (kein erfundener Treffertest)');

  select count(*) into premature_fill_count
  from public.signal_outcomes
  where filled_at is not null and outcome_at < fired_at + (horizon_hours || ' hours')::interval;
  return next is(premature_fill_count, 0, 'outcome_at liegt nie vor dem Zielzeitpunkt (fired_at + horizon) -- kein Blick in die falsche Kerze');

  select count(*) into dup_count
  from (
    select source_table, source_id, signal_type, horizon_hours, count(*) c
    from public.signal_outcomes
    group by 1,2,3,4
    having count(*) > 1
  ) d;
  return next is(dup_count, 0, 'Keine doppelten (source_table, source_id, signal_type, horizon_hours)-Kombinationen');

  return next is(
    (select count(*)::int from public.signal_outcomes where category = '' or signal_type = ''),
    0,
    'category/signal_type sind nie leer'
  );

  return next is(
    (select count(*)::int from public.signal_outcomes where direction_expected is not null and direction_expected not in ('bullish', 'bearish')),
    0,
    'direction_expected ist immer bullish/bearish oder NULL (Check-Constraint)'
  );

  return next finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_signal_stats_tests()
 RETURNS SETOF text
 LANGUAGE plpgsql
AS $function$
declare
  b record;
  cnt_before int;
  cnt_after int;
  bad_count int;
  window_count int;
begin
  return next plan(13);

  -- 1) Baseline-Sanity: Richtungswahrscheinlichkeiten liegen in [0,1] und
  --    es gibt genug Paare fuer eine belastbare Baseline (Fenster "all",
  --    Horizont 4h -- die groesste verfuegbare Stichprobe).
  select * into b from public.signal_baseline_stats(4, 'all');
  return next ok(b.baseline_bullish_rate between 0 and 1, 'Baseline bullish-Rate liegt in [0,1]');
  return next ok(b.baseline_bearish_rate between 0 and 1, 'Baseline bearish-Rate liegt in [0,1]');
  return next cmp_ok(b.n_pairs, '>', 1000, 'Baseline (Fenster all, 4h) hat eine grosse Stichprobe (keine Zufallsschwankung durch Kleinstichprobe)');

  -- 2) compute_signal_stats fuellt/aktualisiert signal_stats_results fuer
  --    beide Fenster.
  perform public.compute_signal_stats('90d');
  perform public.compute_signal_stats('all');
  select count(*) into window_count from (select distinct window_label from public.signal_stats_results) w;
  return next is(window_count, 2, 'Beide Fenster (90d und all) sind nach einem Lauf vertreten');

  -- 3) Idempotenz: zweiter Lauf desselben Fensters ohne neue signal_outcomes
  --    dazwischen aendert die Zeilenanzahl nicht (Upsert, kein Duplikat).
  select count(*) into cnt_before from public.signal_stats_results where window_label = '90d';
  perform public.compute_signal_stats('90d');
  select count(*) into cnt_after from public.signal_stats_results where window_label = '90d';
  return next is(cnt_after, cnt_before, 'Wiederholter compute_signal_stats-Lauf ist idempotent (Upsert, keine Duplikate)');

  -- 4) Mindeststichprobe: keine Zelle mit n < 10 hat einen p-Wert/Rang/
  --    Signifikanz-Flag -- "keine Aussage" statt erfundener Sicherheit.
  select count(*) into bad_count
  from public.signal_stats_results
  where n < 10 and (raw_p_value is not null or rank is not null or significant_after_bh is not null);
  return next is(bad_count, 0, 'Zellen mit n<10 bleiben ohne p-Wert/Rang/Signifikanz-Flag');

  -- 5) test_type/Spalten-Konsistenz: directional-Zeilen haben Trefferquote-
  --    Spalten, magnitude-Zeilen haben Magnitude-Spalten -- nie beides oder
  --    keins.
  select count(*) into bad_count
  from public.signal_stats_results
  where test_type = 'directional' and (hit_rate_pct is null or baseline_hit_rate_pct is null);
  return next is(bad_count, 0, 'Jede directional-Zeile hat hit_rate_pct und baseline_hit_rate_pct');

  select count(*) into bad_count
  from public.signal_stats_results
  where test_type = 'magnitude' and (avg_abs_return_pct is null or baseline_avg_abs_return_pct is null);
  return next is(bad_count, 0, 'Jede magnitude-Zeile hat avg_abs_return_pct und baseline_avg_abs_return_pct');

  select count(*) into bad_count
  from public.signal_stats_results
  where (test_type = 'directional') <> (direction_expected is not null);
  return next is(bad_count, 0, 'test_type=directional genau dann, wenn direction_expected gesetzt ist');

  -- 6) BH-FDR-Formel-Konsistenz: bh_critical_value = (rank/m)*0.05, wobei m
  --    die Anzahl der in DEMSELBEN Fenster tatsaechlich getesteten Zellen
  --    (raw_p_value IS NOT NULL) ist.
  select count(*) into bad_count
  from public.signal_stats_results r
  where r.raw_p_value is not null
    and abs(r.bh_critical_value - (
      r.rank::numeric / (select count(*) from public.signal_stats_results r2
                          where r2.window_label = r.window_label and r2.raw_p_value is not null)
    ) * 0.05) > 0.0001;
  return next is(bad_count, 0, 'bh_critical_value entspricht (rank/m)*0.05 innerhalb desselben Fensters');

  -- 7) significant_after_bh stimmt ueberall mit raw_p_value <= bh_critical_value ueberein.
  select count(*) into bad_count
  from public.signal_stats_results
  where raw_p_value is not null and significant_after_bh is distinct from (raw_p_value <= bh_critical_value);
  return next is(bad_count, 0, 'significant_after_bh = (raw_p_value <= bh_critical_value) ueberall');

  -- 8) window_label akzeptiert nur die zwei definierten Werte (Check-Constraint).
  return next is(
    (select count(*)::int from public.signal_stats_results where window_label not in ('90d', 'all')),
    0,
    'window_label ist immer 90d oder all'
  );

  -- 9) compute_signal_stats lehnt ein unbekanntes Fenster ab (kein stiller
  --    Fallback auf ein falsches Fenster).
  return next throws_ok(
    'select public.compute_signal_stats(''bogus'')',
    'p_window muss 90d oder all sein, war: bogus',
    'compute_signal_stats() lehnt ein unbekanntes Fenster explizit ab'
  );

  return next finish();
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_weekly_signal_stats()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.compute_signal_stats('90d');
  select public.compute_signal_stats('all');
$function$;

CREATE OR REPLACE FUNCTION public.signal_baseline_stats(p_horizon_hours integer, p_window text)
 RETURNS TABLE(baseline_bullish_rate numeric, baseline_bearish_rate numeric, n_pairs integer, avg_abs_return_pct numeric, stddev_abs_return_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tv_infer_signal_direction(p_signal_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when upper(p_signal_type) like '%BULLISH%' or upper(p_signal_type) like '%\_BULL' escape '\' then 'bullish'
    when upper(p_signal_type) like '%BEARISH%' or upper(p_signal_type) like '%\_BEAR' escape '\' then 'bearish'
    when upper(p_signal_type) like '%\_LOW' escape '\' or upper(p_signal_type) like '%\_LO' escape '\' then 'bullish'
    when upper(p_signal_type) like '%\_HIGH' escape '\' or upper(p_signal_type) like '%\_HI' escape '\' then 'bearish'
    else null
  end
$function$;

