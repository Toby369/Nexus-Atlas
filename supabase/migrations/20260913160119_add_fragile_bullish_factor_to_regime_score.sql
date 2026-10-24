-- Exportiert aus supabase_migrations.schema_migrations (20260913160119 add_fragile_bullish_factor_to_regime_score)

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
