-- Exportiert aus supabase_migrations.schema_migrations (20260913132340 add_dxy_to_regime_score_live)


-- 12.09.2026 -- DXY-Bewegung im Live-Lookup ergaenzt (siehe
-- add_dxy_factor_to_regime_score-Migration). Return-Type aendert sich
-- (neue Spalte dxy_active) -- drop noetig, CREATE OR REPLACE reicht bei
-- geaendertem RETURNS TABLE nicht.
drop function if exists research_regime_score_live();

create or replace function research_regime_score_live()
returns table(
  out_direction text,
  trend_konsens integer,
  cvd_z_active boolean,
  momentum_active boolean,
  bollinger_pctb_active boolean,
  dxy_active boolean,
  probability numeric,
  tier text,
  data_asof timestamptz
)
language plpgsql
stable
as $function$
declare
  v_now timestamptz := now();
  v_1h record;
  v_4h record;
  v_1d record;
  v_rm record;
  v_dxy record;
  v_konsens_up integer;
  v_konsens_down integer;
  v_cvdz_up boolean;
  v_cvdz_down boolean;
  v_bb_up boolean;
  v_mom_down boolean;
  v_dxy_up boolean;
  v_dxy_down boolean;
  v_asof timestamptz;
begin
  select structure_trend, candle_open_time into v_1h from market_features
  where symbol='BTCUSDT' and interval='1h' and candle_open_time <= v_now order by candle_open_time desc limit 1;
  select structure_trend, candle_open_time into v_4h from market_features
  where symbol='BTCUSDT' and interval='4h' and candle_open_time <= v_now order by candle_open_time desc limit 1;
  select structure_trend, candle_open_time into v_1d from market_features
  where symbol='BTCUSDT' and interval='1d' and candle_open_time <= v_now order by candle_open_time desc limit 1;

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

  return query
  select 'UP'::text, v_konsens_up, v_cvdz_up, null::boolean, v_bb_up, v_dxy_up,
    round(research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='dxy' and level=v_dxy_up::text),0)
    ), 1) as probability,
    case when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='dxy' and level=v_dxy_up::text),0)
    ) <= t.tier_low_max_pct then 'Niedrig'
    when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='UP' and factor='dxy' and level=v_dxy_up::text),0)
    ) <= t.tier_mid_max_pct then 'Mittel' else 'Hoch' end as tier,
    v_asof
  from (select base_logit, research_sigmoid(tier_low_max) as tier_low_max_pct, research_sigmoid(tier_mid_max) as tier_mid_max_pct from research_regime_score_tiers where research_regime_score_tiers.direction='UP') t
  union all
  select 'DOWN'::text, v_konsens_down, v_cvdz_down, v_mom_down, null::boolean, v_dxy_down,
    round(research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='dxy' and level=v_dxy_down::text),0)
    ), 1) as probability,
    case when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='dxy' and level=v_dxy_down::text),0)
    ) <= t.tier_low_max_pct then 'Niedrig'
    when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
      + coalesce((select woe from research_regime_score_woe where research_regime_score_woe.direction='DOWN' and factor='dxy' and level=v_dxy_down::text),0)
    ) <= t.tier_mid_max_pct then 'Mittel' else 'Hoch' end as tier,
    v_asof
  from (select base_logit, research_sigmoid(tier_low_max) as tier_low_max_pct, research_sigmoid(tier_mid_max) as tier_mid_max_pct from research_regime_score_tiers where research_regime_score_tiers.direction='DOWN') t;
end;
$function$;
