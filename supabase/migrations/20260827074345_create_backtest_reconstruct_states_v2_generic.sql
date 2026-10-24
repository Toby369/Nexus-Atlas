-- Exportiert aus supabase_migrations.schema_migrations (20260827074345 create_backtest_reconstruct_states_v2_generic)


-- 4H/1D-Erweiterung fuer mehr Marktregime-Abdeckung. market_features hat
-- real deutlich mehr Historie auf 4H (seit 15.07.2025) und 1D (seit
-- 19.12.2025) als auf 1H (nur seit 15.08.2026) -- damit deckt ein
-- Backtest ueber diese Intervalle mehrere echte Marktphasen ab statt nur
-- die aktuellen 11 Tage Aufwaertstrend.
--
-- WICHTIG, bewusst nicht geloest (keine stille Neukalibrierung -- Phase-3-
-- Vorgabe): die 14 Schwellenwerte sind 1:1 aus compute-market-state v8
-- gespiegelt, das explizit auf 1H kalibriert ist. Zwei Schwellen sind
-- NAMENTLICH intervall-spezifisch benannt und ihre Uebertragbarkeit auf
-- 4H/1D ist UNGEPRUEFT:
--   - OI_DELTA_1H_THRESHOLD_PCT (0.3%) -- ein OI-Delta ueber 4H/1D ist
--     strukturell groesser als ueber 1H, derselbe Schwellenwert duerfte
--     auf laengeren Intervallen zu oft ansprechen.
--   - VWAP_NEUTRAL_BAND_PCT (0.15%) -- VWAP-Anker-Verhalten ueber
--     laengere Intervalle ist nicht verifiziert.
-- Die uebrigen 12 Faktoren beruhen entweder auf bereits intervall-nativ
-- berechneten kategorischen Werten (structure_trend, cvd_trend etc. --
-- die zugrundeliegenden Indikatoren werden je Intervall neu berechnet)
-- oder auf intervall-unabhaengigen Punktwerten (funding, basis, put/call-
-- ratio, Sentiment-Klassifikation, Makro-Regime). Diese Einschraenkung
-- gilt nur fuer oi_price und vwap_position auf 4H/1D und wird hier
-- dokumentiert, nicht automatisch korrigiert -- eine neue Kalibrierung
-- bleibt Phase 11 vorbehalten.
--
-- Generische Variante von backtest_reconstruct_1h_states_v2(): identische
-- Faktorlogik, parametrisiert nach Intervall. Die bestehende 1H-Funktion
-- und ihr Cron-Job bleiben UNVERAENDERT (kein Risiko fuer den bereits
-- verifizierten, laufenden Pfad) -- diese Funktion ist additiv fuer 4H/1D.
create or replace function public.backtest_reconstruct_states_v2(p_interval text, p_from timestamptz default null, p_to timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_offset interval;
begin
  if p_interval not in ('1h', '4h', '1d') then
    raise exception 'backtest_reconstruct_states_v2: unsupported interval %, expected 1h/4h/1d', p_interval;
  end if;
  v_offset := case p_interval when '1h' then interval '1 hour' when '4h' then interval '4 hours' else interval '1 day' end;

  with mf as (
    select *
    from market_features
    where symbol = 'BTCUSDT' and interval = p_interval
      and (p_from is null or candle_open_time >= p_from)
      and (p_to is null or candle_open_time <= p_to)
  ),
  ct as (
    select *, candle_open_time + v_offset as close_time_utc from mf
  ),
  funding_asof as (
    select
      ct.candle_open_time,
      (
        select avg(m.funding_rate)
        from (
          select distinct on (exchange) exchange, funding_rate
          from market_snapshots
          where status = 'ok' and funding_rate is not null and timestamp_utc <= ct.close_time_utc
          order by exchange, timestamp_utc desc
        ) m
      ) as avg_funding_rate
    from ct
  ),
  positioning_asof as (
    select ct.candle_open_time, p.score
    from ct
    left join lateral (
      select score
      from positioning_signals
      where timestamp_utc <= ct.close_time_utc
        and timestamp_utc >= ct.close_time_utc - interval '30 minutes'
      order by timestamp_utc desc
      limit 1
    ) p on true
  ),
  orderbook_asof as (
    select
      ct.candle_open_time,
      (
        select avg(o.depth_imbalance)
        from orderbook_snapshots o
        where o.symbol = 'BTCUSDT' and o.status = 'ok' and o.depth_imbalance is not null
          and o.timestamp_utc = (
            select max(o2.timestamp_utc) from orderbook_snapshots o2
            where o2.symbol = 'BTCUSDT' and o2.status = 'ok'
              and o2.timestamp_utc <= ct.close_time_utc
              and o2.timestamp_utc >= ct.close_time_utc - interval '30 minutes'
          )
      ) as avg_imbalance
    from ct
  ),
  options_asof as (
    select ct.candle_open_time, o.put_call_oi_ratio
    from ct
    left join lateral (
      select put_call_oi_ratio
      from options_snapshots
      where status = 'ok'
        and timestamp_utc <= ct.close_time_utc
        and timestamp_utc >= ct.close_time_utc - interval '2 hours'
      order by timestamp_utc desc
      limit 1
    ) o on true
  ),
  sentiment_asof as (
    select ct.candle_open_time, s.classification
    from ct
    left join lateral (
      select classification
      from sentiment_snapshots
      where status = 'ok'
        and timestamp_utc <= ct.close_time_utc
        and timestamp_utc >= ct.close_time_utc - interval '3 hours'
      order by timestamp_utc desc
      limit 1
    ) s on true
  ),
  macro_asof as (
    select ct.candle_open_time, public.get_macro_regime_asof(ct.close_time_utc) as regime_result
    from ct
  ),
  computed as (
    select
      ct.candle_open_time,
      ct.close_time_utc,
      jsonb_build_object(
        'structure', jsonb_build_object(
          'value', case when ct.structure_trend = 'bullish' then 1 when ct.structure_trend = 'bearish' then -1 else 0 end,
          'basis', jsonb_build_object('structure_trend', ct.structure_trend)),
        'momentum', jsonb_build_object(
          'value', case when ct.rsi_14 is null or ct.macd_histogram is null then null
                        when ct.rsi_14 > 55 and ct.macd_histogram > 0 then 1
                        when ct.rsi_14 < 45 and ct.macd_histogram < 0 then -1
                        else 0 end,
          'basis', jsonb_build_object('rsi_14', ct.rsi_14, 'macd_histogram', ct.macd_histogram)),
        'cvd', jsonb_build_object(
          'value', case when ct.cvd_trend = 'rising' then 1 when ct.cvd_trend = 'falling' then -1 else 0 end,
          'basis', jsonb_build_object('cvd_trend', ct.cvd_trend)),
        'oi_price', jsonb_build_object(
          'value', case when ct.oi_delta_pct is null or ct.close_price is null or ct.ema_20 is null then null
                        when abs(ct.oi_delta_pct) > 0.3 then (case when ct.close_price > ct.ema_20 then 1 else -1 end)
                        else 0 end,
          'basis', jsonb_build_object('oi_delta_pct', ct.oi_delta_pct, 'threshold_unverified_for_interval', p_interval <> '1h')),
        'trend_strength', jsonb_build_object(
          'value', case when ct.adx_14 is null or ct.plus_di is null or ct.minus_di is null then null
                        when ct.adx_14 < 20 then 0
                        when ct.plus_di > ct.minus_di then 1
                        when ct.minus_di > ct.plus_di then -1
                        else 0 end,
          'basis', jsonb_build_object('adx_14', ct.adx_14)),
        'trend_regime', jsonb_build_object(
          'value', case when ct.close_price is null or ct.ema_50 is null or ct.ema_200 is null then null
                        when ct.close_price > ct.ema_50 and ct.ema_50 > ct.ema_200 then 1
                        when ct.close_price < ct.ema_50 and ct.ema_50 < ct.ema_200 then -1
                        else 0 end,
          'basis', jsonb_build_object('ema_50', ct.ema_50, 'ema_200', ct.ema_200)),
        'vwap_position', jsonb_build_object(
          'value', case when ct.vwap is null or ct.close_price is null or ct.vwap = 0 then null
                        when ((ct.close_price - ct.vwap) / ct.vwap) * 100 > 0.15 then 1
                        when ((ct.close_price - ct.vwap) / ct.vwap) * 100 < -0.15 then -1
                        else 0 end,
          'basis', jsonb_build_object('vwap', ct.vwap, 'threshold_unverified_for_interval', p_interval <> '1h')),
        'basis', jsonb_build_object(
          'value', case when ct.basis_pct is null then null
                        when ct.basis_pct > 0.15 then -1
                        when ct.basis_pct < -0.15 then 1
                        else 0 end,
          'basis', jsonb_build_object('basis_pct', ct.basis_pct)),
        'funding', jsonb_build_object(
          'value', case when fa.avg_funding_rate is null then null
                        when fa.avg_funding_rate > 0.0005 then -1
                        when fa.avg_funding_rate < -0.0005 then 1
                        else 0 end,
          'basis', jsonb_build_object('avg_funding_rate', fa.avg_funding_rate)),
        'positioning', jsonb_build_object(
          'value', case when pa.score is null then null
                        when pa.score > 10 then 1
                        when pa.score < -10 then -1
                        else 0 end,
          'basis', jsonb_build_object('score', pa.score)),
        'orderbook', jsonb_build_object(
          'value', case when oba.avg_imbalance is null then null
                        when oba.avg_imbalance > 0.08 then 1
                        when oba.avg_imbalance < -0.08 then -1
                        else 0 end,
          'basis', jsonb_build_object('avg_depth_imbalance', oba.avg_imbalance)),
        'options', jsonb_build_object(
          'value', case when oa.put_call_oi_ratio is null then null
                        when oa.put_call_oi_ratio < 0.7 then 1
                        when oa.put_call_oi_ratio > 1.1 then -1
                        else 0 end,
          'basis', jsonb_build_object('put_call_oi_ratio', oa.put_call_oi_ratio)),
        'macro', jsonb_build_object(
          'value', case when ma.regime_result->>'regime' is null then null
                        when ma.regime_result->>'regime' = 'Risk-On' then 1
                        when ma.regime_result->>'regime' = 'Risk-Off' then -1
                        else 0 end,
          'basis', jsonb_build_object('regime', ma.regime_result->>'regime')),
        'sentiment', jsonb_build_object(
          'value', case when sa.classification is null then null
                        when sa.classification = 'Extreme Fear' then 1
                        when sa.classification = 'Extreme Greed' then -1
                        else 0 end,
          'basis', jsonb_build_object('classification', sa.classification))
      ) as factors
    from ct
    left join funding_asof fa on fa.candle_open_time = ct.candle_open_time
    left join positioning_asof pa on pa.candle_open_time = ct.candle_open_time
    left join orderbook_asof oba on oba.candle_open_time = ct.candle_open_time
    left join options_asof oa on oa.candle_open_time = ct.candle_open_time
    left join macro_asof ma on ma.candle_open_time = ct.candle_open_time
    left join sentiment_asof sa on sa.candle_open_time = ct.candle_open_time
  )
  insert into public.backtest_states (timestamp_utc, candle_open_time, interval, factors, unreconstructed_factors, domain_result, architecture_version, point_in_time_safe)
  select
    c.close_time_utc,
    c.candle_open_time,
    p_interval,
    c.factors,
    array[]::text[],
    public.experimental_domain_signal_state(c.factors),
    'experimental_domain_v2_phase4_full_asof',
    true
  from computed c
  on conflict (candle_open_time, interval, architecture_version) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.backtest_reconstruct_states_v2(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.backtest_reconstruct_states_v2(text, timestamptz, timestamptz) to service_role;
