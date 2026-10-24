-- Exportiert aus supabase_migrations.schema_migrations (20260920180702 add_fear_greed_value_to_confluence_score_live)

drop function if exists public.research_confluence_score_live();

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

grant execute on function public.research_confluence_score_live() to anon, authenticated;
