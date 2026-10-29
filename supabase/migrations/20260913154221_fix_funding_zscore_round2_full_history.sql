-- Exportiert aus supabase_migrations.schema_migrations (20260913154221 fix_funding_zscore_round2_full_history)

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
