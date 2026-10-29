-- Exportiert aus supabase_migrations.schema_migrations (20260912052450 create_confluence_score_live_v2)


create or replace function research_confluence_score_live()
returns table (
  direction text,
  trend_count integer,
  fear_greed_active boolean,
  fear_greed_classification text,
  makro_active boolean,
  makro_regime text,
  orderbuch_active boolean,
  orderbuch_imbalance numeric,
  probability numeric,
  tier text,
  data_asof timestamptz
)
language plpgsql
stable
as $$
declare
  v_dir text;
  v_15m record;
  v_1h record;
  v_4h record;
  v_1d record;
  v_ob record;
  v_fg record;
  v_makro jsonb;
  v_long_count integer;
  v_short_count integer;
  v_mtf_long boolean;
  v_mtf_short boolean;
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

  select classification, timestamp_utc into v_fg
  from sentiment_snapshots where source='alternative.me' order by timestamp_utc desc limit 1;

  select get_macro_regime() into v_makro;

  v_mtf_long := coalesce(v_1h.structure_trend = 'bullish' and now() - v_1h.candle_open_time <= interval '4 hours', false)
    and coalesce(v_4h.structure_trend = 'bullish' and now() - v_4h.candle_open_time <= interval '8 hours', false)
    and coalesce(v_1d.structure_trend = 'bullish' and now() - v_1d.candle_open_time <= interval '30 hours', false);
  v_mtf_short := coalesce(v_1h.structure_trend = 'bearish' and now() - v_1h.candle_open_time <= interval '4 hours', false)
    and coalesce(v_4h.structure_trend = 'bearish' and now() - v_4h.candle_open_time <= interval '8 hours', false)
    and coalesce(v_1d.structure_trend = 'bearish' and now() - v_1d.candle_open_time <= interval '30 hours', false);

  v_long_count :=
    (coalesce(v_15m.structure_trend = 'bullish' and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_1h.structure_trend = 'bullish' and now() - v_1h.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_4h.structure_trend = 'bullish' and now() - v_4h.candle_open_time <= interval '8 hours', false))::int
    + (coalesce(v_1d.structure_trend = 'bullish' and now() - v_1d.candle_open_time <= interval '30 hours', false))::int
    + v_mtf_long::int
    + (coalesce(v_15m.cvd_trend = 'rising' and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_15m.adx_14 >= 20 and v_15m.plus_di > v_15m.minus_di and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_15m.ema_50 > v_15m.ema_200 and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_15m.close_price > v_15m.vwap and now() - v_15m.candle_open_time <= interval '4 hours', false))::int;

  v_short_count :=
    (coalesce(v_15m.structure_trend = 'bearish' and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_1h.structure_trend = 'bearish' and now() - v_1h.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_4h.structure_trend = 'bearish' and now() - v_4h.candle_open_time <= interval '8 hours', false))::int
    + (coalesce(v_1d.structure_trend = 'bearish' and now() - v_1d.candle_open_time <= interval '30 hours', false))::int
    + v_mtf_short::int
    + (coalesce(v_15m.cvd_trend = 'falling' and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_15m.adx_14 >= 20 and v_15m.minus_di > v_15m.plus_di and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_15m.ema_50 < v_15m.ema_200 and now() - v_15m.candle_open_time <= interval '4 hours', false))::int
    + (coalesce(v_15m.close_price < v_15m.vwap and now() - v_15m.candle_open_time <= interval '4 hours', false))::int;

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
    fear_greed_classification := v_fg.classification;
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
$$;
