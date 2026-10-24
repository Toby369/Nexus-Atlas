-- Exportiert aus supabase_migrations.schema_migrations (20260912131043 create_regime_score_live_and_cron)

-- Gesamteinschaetzung-Score-Protokoll Abschnitt 8: Live-Lookup (analog
-- research_confluence_score_live()) + woechentlicher Cron-Schritt, damit
-- dieser Score von Anfang an "lernbar" ist (Struktur-Konzept Abschnitt 0)
-- statt ein einmaliger Snapshot zu bleiben.

create or replace function research_regime_score_live()
returns table(
  direction text,
  trend_konsens integer,
  cvd_z_active boolean,
  momentum_active boolean,
  bollinger_pctb_active boolean,
  probability numeric,
  tier text,
  data_asof timestamptz
)
language plpgsql
stable
as $function$
declare
  v_now timestamptz := now();
  v_trend_signals constant text[] := array[
    'Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung'
  ];
  v_1h record;
  v_4h record;
  v_1d record;
  v_rm record;
  v_konsens_up integer;
  v_konsens_down integer;
  v_cvdz_up boolean;
  v_cvdz_down boolean;
  v_bb_up boolean;
  v_mom_down boolean;
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

  return query
  select 'UP'::text, v_konsens_up, v_cvdz_up, null::boolean, v_bb_up,
    round(research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
    ), 1) as probability,
    case when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
    ) <= t.tier_low_max_pct then 'Niedrig'
    when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='trend_konsens' and level=v_konsens_up::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='cvd_z' and level=v_cvdz_up::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='bollinger_pctb' and level=v_bb_up::text),0)
    ) <= t.tier_mid_max_pct then 'Mittel' else 'Hoch' end as tier,
    v_asof
  from (select base_logit, research_sigmoid(tier_low_max) as tier_low_max_pct, research_sigmoid(tier_mid_max) as tier_mid_max_pct from research_regime_score_tiers where direction='UP') t
  union all
  select 'DOWN'::text, v_konsens_down, v_cvdz_down, v_mom_down, null::boolean,
    round(research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
    ), 1) as probability,
    case when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
    ) <= t.tier_low_max_pct then 'Niedrig'
    when research_sigmoid(
      t.base_logit
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='trend_konsens' and level=v_konsens_down::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='cvd_z' and level=v_cvdz_down::text),0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='momentum' and level=v_mom_down::text),0)
    ) <= t.tier_mid_max_pct then 'Mittel' else 'Hoch' end as tier,
    v_asof
  from (select base_logit, research_sigmoid(tier_low_max) as tier_low_max_pct, research_sigmoid(tier_mid_max) as tier_mid_max_pct from research_regime_score_tiers where direction='DOWN') t;
end;
$function$;

comment on function research_regime_score_live() is
  'Gesamteinschaetzung-Score-Protokoll: Live-Lookup fuer die aktuelle Marktlage, analog '
  'research_confluence_score_live(). Noch kein Ebene-1-Score (siehe NEXUS-STRUKTUR-KONZEPT '
  'Abschnitt 5) -- 17 von 39 Kandidaten getestet, weitere Validierung ausstehend.';

-- Woechentlicher Cron-Schritt (Abschnitt 0 Struktur-Konzept: "Nexus und der
-- Score sind lernbar") -- eigener Job, bewusst getrennt vom
-- confluence-score-pipeline-weekly-Job (Abschnitt 6 des Protokolls: nie
-- gemeinsame Gewichte/Pipeline-Schritte fuer unterschiedliche Zielgroessen).
select cron.schedule(
  'regime-score-pipeline-weekly',
  '30 5 * * 1',
  $$ select research_regime_extend_activation(); select research_regime_refresh_stats(); select research_regime_score_refresh(); $$
);
